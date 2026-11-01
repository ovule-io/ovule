import assert from "node:assert/strict";
import WebSocket from "ws";
import http from "node:http";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9261");
const externalTargetUrl = process.env.OVULE_CONTEXT_MENU_URL?.trim();
const targetUrl = externalTargetUrl || `http://127.0.0.1:${port + 1}/context-menu-fixture`;
let fixtureServer;
let fixtureRequests = 0;
if (!externalTargetUrl) {
  fixtureServer = http.createServer((request, response) => {
    if (request.url === "/context-menu-fixture") fixtureRequests++;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Explorer context menu fixture</title><h1>Context menu stays alive</h1>",
    );
  });
  await new Promise((resolve, reject) => {
    fixtureServer.once("error", reject);
    fixtureServer.listen(port + 1, "127.0.0.1", resolve);
  });
}
let commandId = 0;
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
  timeout: 45_000,
});

try {
  const app = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => isOvuleResource(page.url(), "index.html")),
  );
  app.setDefaultTimeout(30_000);
  await app.evaluate(() => localStorage.setItem("ovule.onboarding.dismissed", "true"));
  await app.reload();
  await app.locator(".sidebar").waitFor();
  await app.evaluate((target) => {
    window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: { target } }));
  }, targetUrl);

  const target = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return undefined;
    const candidates = await response.json();
    return candidates.find(
      (candidate) =>
        candidate.type === "webview" &&
        candidate.url?.startsWith(new URL(targetUrl).origin) &&
        candidate.webSocketDebuggerUrl,
    );
  }, 45_000);

  const socket = await openSocket(target.webSocketDebuggerUrl);
  try {
    await sendCdp(socket, "Page.enable");
    await sendCdp(socket, "Runtime.enable");
    await waitFor(async () => {
      const result = await sendCdp(socket, "Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      return result.result?.result?.value === "complete";
    }, 45_000);

    const initialRequests = fixtureRequests;
    await app.evaluate(async () => {
      const pane = document.querySelector("[data-tool-tab] explorer");
      await pane.postMessage({
        type: "appearance.sync",
        theme: document.documentElement.dataset.theme,
        language: document.documentElement.lang,
      });
      await pane.postMessage({
        type: "appearance.sync",
        theme: document.documentElement.dataset.theme,
        language: document.documentElement.lang,
      });
    });
    const metrics = await sendCdp(socket, "Page.getLayoutMetrics");
    const viewport = metrics.result?.cssVisualViewport ??
      metrics.result?.visualViewport ?? { clientWidth: 800, clientHeight: 600 };
    const x = Math.max(32, Math.min(viewport.clientWidth / 2, 400));
    const y = Math.max(32, Math.min(viewport.clientHeight / 2, 300));
    const probeGeometry = await app.evaluate(() => {
      const pane = document.querySelector("[data-tool-tab] explorer");
      const bounds = pane.getBoundingClientRect();
      return {
        screenX: window.screenX,
        screenY: window.screenY,
        paneLeft: bounds.left,
        paneTop: bounds.top,
      };
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await sendCdp(socket, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "right",
        buttons: 2,
        clickCount: 1,
      });
      await sendCdp(socket, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "right",
        buttons: 0,
        clickCount: 1,
      });
      if (attempt === 0 && Number(process.env.OVULE_CONTEXT_MENU_HOLD_MS) > 0) {
        process.stdout.write(
          `context_menu_probe=${JSON.stringify({
            clickScreenX: Math.round(probeGeometry.screenX + probeGeometry.paneLeft + x),
            clickScreenY: Math.round(probeGeometry.screenY + probeGeometry.paneTop + y),
            x,
            y,
          })}\n`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Number(process.env.OVULE_CONTEXT_MENU_HOLD_MS)),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
      await sendCdp(socket, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await sendCdp(socket, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
    }
    const title = await sendCdp(socket, "Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    assert.ok(await cdpAlive(), "CDP endpoint disappeared after right-click");
    const currentTargets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    assert.ok(
      currentTargets.some(
        (candidate) =>
          candidate.id === target.id && candidate.type === "webview" && candidate.parentId,
      ),
      "Appearance sync recreated or detached the nested Explorer guest",
    );
    if (fixtureServer)
      assert.equal(
        fixtureRequests,
        initialRequests,
        "Appearance sync repeatedly reloaded the Browser guest",
      );
    process.stdout.write(
      `${JSON.stringify({
        status: "ok",
        target: target.url,
        title: title.result?.result?.value,
        rightClicks: 3,
        appearanceSyncStable: true,
        fixtureRequests,
      })}\n`,
    );
  } finally {
    socket.close();
  }
} catch (error) {
  console.error(
    "context_menu_targets=" +
      JSON.stringify(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()),
  );
  throw error;
} finally {
  await browser.close();
  if (fixtureServer) {
    fixtureServer.closeAllConnections();
    await new Promise((resolve) => fixtureServer.close(resolve));
  }
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    return url.protocol === "ovule:" && url.host === "-" && url.pathname === "/main";
  } catch {
    return false;
  }
}

async function cdpAlive() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
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
