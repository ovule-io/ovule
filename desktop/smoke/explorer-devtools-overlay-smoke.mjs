import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";
import WebSocket from "ws";

const port = Number(process.env.OVULE_CDP_PORT ?? "9251");
const screenshot = process.env.OVULE_OVERLAY_SCREENSHOT;
const explorerScreenshot = process.env.OVULE_EXPLORER_OVERLAY_SCREENSHOT;
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const explorer = targets.find(
  (target) => target.type === "webview" && !target.url.startsWith("ovule:"),
);
assert.ok(explorer?.webSocketDebuggerUrl, "Browser Explorer CDP target is missing");

const socket = new WebSocket(explorer.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result ?? {});
});
function command(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await command("DOM.enable");
  await command("Overlay.enable");
  const { root } = await command("DOM.getDocument", { depth: 1 });
  const { nodeId } = await command("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "body",
  });
  assert.ok(nodeId, "Explorer document body is missing");
  await command("Overlay.highlightNode", {
    nodeId,
    highlightConfig: {
      showInfo: true,
      showStyles: true,
      contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
      paddingColor: { r: 147, g: 196, b: 125, a: 0.66 },
      borderColor: { r: 255, g: 229, b: 153, a: 0.9 },
      marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
    },
  });
  const highlightObject = await command("Overlay.getHighlightObjectForTest", {
    nodeId,
    includeDistance: true,
    includeStyle: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (explorerScreenshot) {
    const captured = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await fs.writeFile(explorerScreenshot, Buffer.from(captured.data, "base64"));
  }
  if (screenshot) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      const app = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((page) => page.url().startsWith("ovule:"));
      assert.ok(app, "Ovule app target is missing");
      await app.screenshot({ path: screenshot });
    } finally {
      await browser.close();
    }
  }
  process.stdout.write(
    `${JSON.stringify({ targetId: explorer.id, url: explorer.url, nodeId, highlightObject, screenshot, explorerScreenshot })}\n`,
  );
  await command("Overlay.hideHighlight");
} finally {
  socket.close();
  if (screenshot) await fs.access(screenshot);
  if (explorerScreenshot) await fs.access(explorerScreenshot);
}
