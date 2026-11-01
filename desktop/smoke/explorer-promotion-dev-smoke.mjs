import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import WebSocket from "ws";
import { chromium } from "playwright-core";

// Exercise the running production UI and real Thread message path, including
// Vite's development origin. Only smoke-created tabs/windows are closed.
const windowModuleUrl = `/@fs${new URL("../features/shell/src/window-platform.ts", import.meta.url).pathname}`;
const endpoint = process.env.OVULE_RUNNING_CDP ?? "http://127.0.0.1:9234";
const output = await mkdtemp(path.join(os.tmpdir(), "ovule-dev-promotion-"));
const title = `Explorer transfer smoke ${Date.now()}`;
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(
    `<!doctype html><title>${title}</title><input id="draft"><script>globalThis.marker=crypto.randomUUID()</script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const sample = `http://127.0.0.1:${server.address().port}/migration-sample`;
const targets = async () => (await fetch(`${endpoint}/json/list`)).json();
const until = async (check, message) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
};
// Explorer targets use the webview type in development. Playwright only
// enumerates page targets, so inspect the guest through its own CDP endpoint.
async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let next = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const result = JSON.parse(raw);
    const request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    clearTimeout(request.timer);
    if (result.error) request.reject(new Error(result.error.message));
    else request.resolve(result.result);
  });
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return {
    close: () => socket.close(),
    send,
    evaluate: async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
        );
      return result.result.value;
    },
  };
}
const browser = await chromium.connectOverCDP(endpoint);
const app = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((page) => new URL(page.url()).pathname === "/main");
assert.ok(app, "Running main window missing");
const sockets = [];
let child;
try {
  assert.equal(
    await app.evaluate(() => typeof document.createElement("explorer").detach),
    "function",
    "Restart with the updated Tuffite Framework first",
  );
  const threadTarget = await until(
    async () => (await targets()).find((target) => new URL(target.url).pathname === "/thread"),
    "Select a conversation before running this smoke",
  );
  assert.ok(threadTarget, "Select a conversation before running this smoke");
  const thread = await connect(threadTarget);
  sockets.push(thread);
  for (const placement of ["sidebar", "sidebar", "sidebar", "workbench", "independent window"]) {
    await thread.evaluate(
      `(async()=>{const {requestRoot}=await import('${new URL("../features/shell/src/explorer-platform.ts", import.meta.url).pathname.replace(/^/, "/@fs")}');return requestRoot('explorer.openOverlay',{target:${JSON.stringify(sample)}})})()`,
    );
    await app.locator("[data-explorer-preview] explorer").waitFor();
    const guestTarget = await until(
      async () => (await targets()).find((target) => target.url.startsWith(sample)),
      "Sample guest missing",
    );
    const guest = await connect(guestTarget);
    sockets.push(guest);
    await until(
      () => guest.evaluate("Boolean(document.querySelector('#draft'))"),
      "Sample document missing",
    );
    await guest.evaluate(
      "document.querySelector('#draft').value='unsaved live dev input';history.pushState({},'', '?edited')",
    );
    const snapshot = () =>
      guest.evaluate(
        "({marker,input:document.querySelector('#draft').value,history:history.length})",
      );
    const before = await snapshot();
    const beforeState = await app.evaluate(async () => {
      const source = document.querySelector("[data-explorer-preview] explorer");
      window.devSmokeSource = source;
      window.devSmokeLoads = 0;
      source.addEventListener("loadstart", () => window.devSmokeLoads++);
      return source.getNavigationState();
    });
    await app.getByRole("button", { name: `Open in ${placement}`, exact: true }).click();
    await app.waitForFunction(() => !document.querySelector("[data-explorer-preview]"));
    let afterState;
    if (placement === "independent window") {
      const target = await until(
        async () =>
          (await targets()).find(
            (target) =>
              new URL(target.url).pathname === "/explorer" && target.url.includes("transfer="),
          ),
        "Independent window missing",
      );
      // There may be user-created independent windows: use the receiver of this
      // sample, rather than selecting the first /explorer target.
      const candidates = (await targets()).filter(
        (target) => target.type === "page" && new URL(target.url).pathname === "/explorer",
      );
      for (const candidate of candidates) {
        const probe = await connect(candidate);
        sockets.push(probe);
        const state = await probe.evaluate(
          "document.querySelector('explorer')?.getNavigationState()",
        );
        if (state?.documentId === beforeState.documentId) {
          child = probe;
          afterState = state;
          break;
        }
      }
      assert.ok(child, `Independent receiver missing (${target.id})`);
      const screenshot = await child.send("Page.captureScreenshot", { format: "png" });
      await writeFile(path.join(output, "independent.png"), Buffer.from(screenshot.data, "base64"));
    } else {
      afterState = await app.evaluate(async (url) => {
        for (const element of document.querySelectorAll("[data-tool-tab] explorer")) {
          const state = await element.getNavigationState();
          if (state.url.startsWith(url)) return state;
        }
      }, sample);
      await app.screenshot({ path: path.join(output, `${placement}.png`) });
    }
    if (placement === "sidebar") {
      const titles = await app.locator("[data-chat-sidebar] .artifact-row").evaluateAll((rows) =>
        rows.map((row) => ({
          thread: row.dataset.threadId,
          title: row.querySelector(".artifact-select")?.getAttribute("title"),
        })),
      );
      const promoted = titles.find((row) => row.title?.startsWith(sample));
      assert.ok(promoted);
      assert.equal(titles.filter((row) => row.thread === promoted.thread)[0].title, promoted.title);
    }
    assert.equal(afterState?.documentId, beforeState.documentId);
    assert.equal(afterState.rendererProcess.id, beforeState.rendererProcess.id);
    assert.deepEqual(await snapshot(), before);
    assert.equal(await app.evaluate(() => window.devSmokeLoads), 0);
    assert.equal(await app.evaluate(() => window.devSmokeSource.isConnected), false);
    const surviving = (await targets()).filter((target) => target.url.startsWith(sample));
    assert.equal(surviving.length, 1);
    assert.equal(surviving[0].id, guestTarget.id);
    if (child) {
      void child
        .evaluate(`import('${windowModuleUrl}').then(m=>m.windowApi()).then(api=>api.close())`)
        .catch(() => {});
      child = undefined;
    } else
      await app
        .locator(`button[aria-label=${JSON.stringify(`Close ${title}`)}]`)
        .first()
        .evaluate((button) => button.click());
    await until(
      async () => !(await targets()).some((target) => target.url.startsWith(sample)),
      "Closing destination retained sample guest",
    );
    console.log(
      `${placement}=ok (overlay closed, same document/renderer/target, no load, preserved input/history)`,
    );
  }
  console.log(`explorer-promotion-dev=ok screenshots=${output}`);
} finally {
  if (child)
    void child
      .evaluate(`import('${windowModuleUrl}').then(m=>m.windowApi()).then(api=>api.close())`)
      .catch(() => {});
  sockets.forEach((socket) => socket.close());
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
