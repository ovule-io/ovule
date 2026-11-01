import assert from "node:assert/strict";
import WebSocket from "ws";
import fs from "node:fs/promises";
import http from "node:http";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9362");
const fixturePort = Number(process.env.OVULE_INSPECT_FIXTURE_PORT ?? String(port + 1));
const externalTargetUrl = process.env.OVULE_INSPECT_URL?.trim();
const targetUrl = externalTargetUrl || `http://127.0.0.1:${fixturePort}/inspect-fixture`;
const readyFile = process.env.OVULE_INSPECT_READY_FILE;
const resultFile = process.env.OVULE_INSPECT_RESULT_FILE;
const beforeScreenshot = process.env.OVULE_INSPECT_BEFORE_SCREENSHOT;
const afterScreenshot = process.env.OVULE_INSPECT_AFTER_SCREENSHOT;
const pickerReadyFile = process.env.OVULE_INSPECT_PICKER_READY_FILE;
const pickerCapturedFile = process.env.OVULE_INSPECT_PICKER_CAPTURED_FILE;
if (!readyFile) throw new Error("OVULE_INSPECT_READY_FILE is required");
if (!resultFile) throw new Error("OVULE_INSPECT_RESULT_FILE is required");
let commandId = 0;
let fixtureServer;
if (!externalTargetUrl) {
  fixtureServer = http.createServer((request, response) => {
    if (request.url !== "/inspect-fixture") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Explorer inspect fixture</title>
          <style>
            html, body { margin: 0; min-height: 100%; background: #fff; color: #18231f; }
            main { margin: 48px; padding: 36px; border: 12px solid #d8a43b;
                   background: #d6f0e3; min-height: 240px; font: 24px sans-serif; }
          </style>
        </head>
        <body><main id="inspect-target">Explorer DevTools overlay fixture</main></body>
      </html>`);
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(fixturePort, "127.0.0.1", resolve);
  });
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
try {
  const app = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => isOvuleResource(page.url(), "index.html")),
  );
  app.setDefaultTimeout(30_000);
  await app.evaluate(async () => localStorage.setItem("ovule.onboarding.dismissed", "true"));
  await app.reload({ waitUntil: "domcontentloaded" });
  await app.locator(".sidebar").waitFor();
  const windowsBefore = await app.evaluate(async () => (await import("/tuffite.js")).window.list());
  await app.evaluate(async (target) => {
    window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: { target } }));
  }, targetUrl);

  const target = await waitFor(async () => {
    const candidates = await cdpTargets();
    return candidates.find(
      (candidate) =>
        candidate.type === "webview" &&
        candidate.url?.startsWith(new URL(targetUrl).origin) &&
        candidate.webSocketDebuggerUrl,
    );
  }, 45_000);
  const inspected = await openSocket(target.webSocketDebuggerUrl);
  try {
    const layerTrees = [];
    inspected.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "LayerTree.layerTreeDidChange") {
        layerTrees.push(message.params?.layers ?? []);
      }
    });
    await sendCdp(inspected, "Page.enable");
    await sendCdp(inspected, "Runtime.enable");
    await sendCdp(inspected, "LayerTree.enable");
    await waitFor(async () => {
      const result = await sendCdp(inspected, "Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      return result.result?.result?.value === "complete";
    }, 45_000);
    const metrics = await sendCdp(inspected, "Page.getLayoutMetrics");
    const viewport = metrics.result?.cssVisualViewport ??
      metrics.result?.visualViewport ?? { clientWidth: 800, clientHeight: 600 };
    const x = Math.max(32, Math.min(viewport.clientWidth / 2, 400));
    const y = Math.max(32, Math.min(viewport.clientHeight / 2, 300));
    await sendCdp(inspected, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "right",
      buttons: 2,
      clickCount: 1,
    });
    await sendCdp(inspected, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "right",
      buttons: 0,
      clickCount: 1,
    });
    await fs.writeFile(readyFile, JSON.stringify({ targetId: target.id, x, y }));
    process.stdout.write(`inspect_menu_ready=true target=${target.url}\n`);

    const frontendTarget = await waitFor(async () => {
      const candidates = await cdpTargets();
      return candidates.find(
        (candidate) =>
          candidate.id !== target.id &&
          candidate.url?.includes(`/devtools/devtools_app.html?targetType=tab`) &&
          candidate.webSocketDebuggerUrl,
      );
    }, 60_000);
    const frontend = await openSocket(frontendTarget.webSocketDebuggerUrl);
    try {
      const frontendDiagnostics = [];
      frontend.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded")
          frontendDiagnostics.push(message);
      });
      await sendCdp(frontend, "Runtime.enable");
      await sendCdp(frontend, "Log.enable");
      const frontendState = await waitFor(async () => {
        const result = await sendCdp(frontend, "Runtime.evaluate", {
          expression:
            "({readyState:document.readyState,title:document.title,text:document.body?.innerText??'',hasHost:typeof window.InspectorFrontendHost==='object',html:document.documentElement?.outerHTML?.slice(0,2000),scripts:[...document.scripts].map(script=>script.src),resources:performance.getEntriesByType('resource').map(entry=>entry.name).slice(0,30)})",
          returnByValue: true,
        });
        const value = result.result?.result?.value;
        // DevTools marks the document complete before Main._showAppUI mounts
        // the asynchronous frontend. Requiring rendered text keeps the old
        // blank-frontend regression detectable without racing healthy startup.
        return value?.readyState === "complete" && value.text?.trim() ? value : undefined;
      }, 60_000);
      assert.ok(
        frontendState.text.trim(),
        `DevTools frontend rendered no UI: ${JSON.stringify(frontendDiagnostics)}`,
      );
      assert.equal(frontendState.hasHost, true, "DevTools frontend host bridge is missing");
      assert.doesNotMatch(
        frontendState.text,
        /disconnected|connection closed|连接断开/i,
        "DevTools frontend reports a disconnected session",
      );
      process.stdout.write(`devtools_frontend_state=${JSON.stringify(frontendState)}\n`);
      // Wait for the Main UI, not only document.readyState. The compatibility
      // API exists earlier than the action listener and can silently drop an
      // enterInspectElementMode event during startup. Clicking the rendered
      // toolbar control reproduces the user's path and avoids that race.
      const pickerButton = await waitFor(async () => {
        const { result } = await sendCdp(frontend, "Runtime.evaluate", {
          expression: `(() => {
            const visit = root => {
              for (const element of root.querySelectorAll('*')) {
                const label = element.getAttribute?.('aria-label') ?? '';
                const title = element.getAttribute?.('title') ?? '';
                if (/select an element in the page to inspect it/i.test(label + ' ' + title)) {
                  return { element, label, title };
                }
                if (element.shadowRoot) {
                  const found = visit(element.shadowRoot);
                  if (found) return found;
                }
              }
            };
            const found = visit(document);
            if (!found) return null;
            return { tag: found.element.tagName, label: found.label, title: found.title };
          })()`,
          returnByValue: true,
        });
        return result.result?.value ?? undefined;
      }, 30_000);
      // InspectElement queues inspectNodeRequested before the frontend has
      // attached. Let that initial reveal finish; otherwise its late
      // EXITED_INSPECT_MODE callback can cancel a picker click made here.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const { result: pickerClickResult } = await sendCdp(frontend, "Runtime.evaluate", {
        expression: `(() => {
          const visit = root => {
            for (const element of root.querySelectorAll('*')) {
              const label = element.getAttribute?.('aria-label') ?? '';
              const title = element.getAttribute?.('title') ?? '';
              if (/select an element in the page to inspect it/i.test(label + ' ' + title)) {
                element.click();
                return true;
              }
              if (element.shadowRoot && visit(element.shadowRoot)) return true;
            }
            return false;
          };
          return visit(document);
        })()`,
        returnByValue: true,
      });
      assert.equal(
        pickerClickResult.result?.value,
        true,
        "DevTools element-picker button could not be clicked",
      );
      await new Promise((resolve) => setTimeout(resolve, 750));
      await sendCdp(inspected, "DOM.enable");
      const { result: documentResult } = await sendCdp(inspected, "DOM.getDocument", {
        depth: 1,
      });
      const { result: bodyResult } = await sendCdp(inspected, "DOM.querySelector", {
        nodeId: documentResult.root.nodeId,
        selector: "body",
      });
      assert.ok(bodyResult.nodeId, "Explorer body is missing");
      const nodeResult = externalTargetUrl
        ? bodyResult
        : (
            await sendCdp(inspected, "DOM.querySelector", {
              nodeId: documentResult.root.nodeId,
              selector: "#inspect-target",
            })
          ).result;
      assert.ok(nodeResult.nodeId, "Explorer inspect fixture target is missing");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const layersBeforeHighlight = summarizeLayers(layerTrees.at(-1) ?? []);
      if (beforeScreenshot) await app.screenshot({ path: beforeScreenshot });
      // The native DevTools frontend owns the Overlay session created by the
      // context-menu Inspect Element command. Do not send setInspectMode or
      // highlightNode from this diagnostic CDP connection: a second Overlay
      // session can replace the native frontend's highlight before the OS
      // screenshot is captured, turning a real pass into a race.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const rawLayersAfterHighlight = layerTrees.at(-1) ?? [];
      const layersAfterHighlight = summarizeLayers(rawLayersAfterHighlight);
      const inspectorLayer = rawLayersAfterHighlight.find(
        (layer) =>
          layer.drawsContent &&
          !layer.backendNodeId &&
          layer.width === Math.round(viewport.clientWidth) &&
          layer.height === Math.round(viewport.clientHeight) &&
          Number(layer.paintCount ?? 0) > 0,
      );
      let inspectorLayerSnapshot;
      if (inspectorLayer) {
        const snapshot = await sendCdp(inspected, "LayerTree.makeSnapshot", {
          layerId: inspectorLayer.layerId,
        });
        try {
          const replay = await sendCdp(inspected, "LayerTree.replaySnapshot", {
            snapshotId: snapshot.result.snapshotId,
          });
          inspectorLayerSnapshot = replay.result.dataURL;
          if (afterScreenshot && inspectorLayerSnapshot?.startsWith("data:image/png;base64,")) {
            const layerPath = afterScreenshot.replace(/\.png$/i, "-inspector-layer.png");
            await fs.writeFile(
              layerPath,
              Buffer.from(inspectorLayerSnapshot.slice("data:image/png;base64,".length), "base64"),
            );
          }
        } finally {
          await sendCdp(inspected, "LayerTree.releaseSnapshot", {
            snapshotId: snapshot.result.snapshotId,
          });
        }
      }
      if (pickerReadyFile) {
        await fs.writeFile(pickerReadyFile, JSON.stringify({ x, y, targetId: target.id }));
      }
      if (pickerCapturedFile) {
        await waitFor(async () => {
          try {
            await fs.access(pickerCapturedFile);
            return true;
          } catch {
            return false;
          }
        }, 30_000);
      }
      // Nested Explorer guests have no standalone compositor surface. The runner
      // verifies the real desktop pixels, while LayerTree covers the inspected guest.
      await sendCdp(inspected, "Overlay.enable");
      const { result: highlightResult } = await sendCdp(
        inspected,
        "Overlay.getHighlightObjectForTest",
        { nodeId: nodeResult.nodeId, includeDistance: true, includeStyle: true },
      );
      if (afterScreenshot) await app.screenshot({ path: afterScreenshot });
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const inspectedAlive = await sendCdp(inspected, "Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      assert.equal(inspectedAlive.result?.result?.value, "complete");
      const windowsAfter = await app.evaluate(async () =>
        (await import("/tuffite.js")).window.list(),
      );
      assert.ok(
        windowsAfter.length > windowsBefore.length,
        `Inspect element did not create a DevTools window: before=${windowsBefore.length}, after=${windowsAfter.length}`,
      );
      const result = {
        status: "ok",
        inspected: target.url,
        frontend: frontendTarget.url,
        frontendTitle: frontendState.title,
        connected: true,
        pickerButton,
        windowsBefore: windowsBefore.length,
        windowsAfter: windowsAfter.length,
        highlightPaths: highlightResult.highlight?.paths?.length ?? 0,
        layerTreeEventCount: layerTrees.length,
        layersBeforeHighlight,
        layersAfterHighlight,
        inspectorLayerId: inspectorLayer?.layerId,
        inspectorLayerSnapshotBytes: inspectorLayerSnapshot?.length ?? 0,
        beforeScreenshot,
        afterScreenshot,
      };
      await fs.writeFile(resultFile, JSON.stringify(result));
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
      frontend.close();
    }
  } finally {
    inspected.close();
  }
} finally {
  if (fixtureServer) {
    fixtureServer.closeAllConnections?.();
    fixtureServer.close();
  }
}
// Browser.close() asks the desktop host to shut down and can wait forever while
// DevTools owns an inspected guest. The runner owns the App lifecycle; exiting
// here closes only this probe's CDP sockets.
process.exit(0);

async function cdpTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) return [];
  return response.json();
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    return url.protocol === "ovule:" && url.host === "-" && url.pathname === "/main";
  } catch {
    return false;
  }
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => reject(new Error(`Timed out opening ${url}`)), 10_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener("error", reject, { once: true });
  });
}

function sendCdp(socket, method, params = {}) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out calling ${method}`)), 10_000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function waitFor(probe, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out; last=${JSON.stringify(value)}`);
}

function summarizeLayers(layers) {
  return layers.map((layer) => ({
    layerId: layer.layerId,
    parentLayerId: layer.parentLayerId,
    backendNodeId: layer.backendNodeId,
    drawsContent: layer.drawsContent,
    width: layer.width,
    height: layer.height,
    offsetX: layer.offsetX,
    offsetY: layer.offsetY,
    paintCount: layer.paintCount,
  }));
}
