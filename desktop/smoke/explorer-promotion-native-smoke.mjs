import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { build } from "vite";

// Use a packaged application and freshly built native runtime, with an isolated
// profile. Only the initial UI is replaced by the existing integration fixture;
// the independent window loads the production /explorer route.
const packagePath = process.env.OVULE_NATIVE_PACKAGE;
const framework = process.env.OVULE_NATIVE_FRAMEWORK;
assert.ok(packagePath && framework, "Set OVULE_NATIVE_PACKAGE and OVULE_NATIVE_FRAMEWORK");
const output = await mkdtemp(path.join(os.tmpdir(), "ovule-native-promotion-"));
let browser;
let application;
let watchdog;
const errors = [];
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(
    '<!doctype html><title>Migration sample</title><input id="draft"><script>globalThis.pageMarker=crypto.randomUUID();globalThis.loads=1</script>',
  );
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const until = async (check, message) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
};
try {
  await listen(server);
  const sample = `http://127.0.0.1:${server.address().port}/migration-sample`;
  const staged = path.join(output, "app");
  await cp(path.resolve(packagePath), staged, { recursive: true });
  // A lightweight business runtime can isolate this UI test from unrelated
  // backend startup (for example, a macOS Keychain permission prompt).
  const businessRuntime = process.env.OVULE_NATIVE_BUSINESS_RUNTIME;
  if (businessRuntime) {
    const manifest = JSON.parse(await readFile(path.join(staged, "manifest.json"), "utf8"));
    await cp(path.resolve(businessRuntime), path.join(staged, manifest.runtime_library));
  }
  // V8 snapshots and locale/resource packs must match the rebuilt runtime.
  const runtimeDirectory = path.dirname(path.resolve(framework));
  for (const entry of await readdir(runtimeDirectory, { withFileTypes: true })) {
    if (
      (entry.isFile() && /\.(?:dylib|dll|so(?:\.\d+)*|pak|dat|bin)$/.test(entry.name)) ||
      ["tuffite_locales", "vk_swiftshader_icd.json", "tuffite.js"].includes(entry.name)
    )
      await cp(path.join(runtimeDirectory, entry.name), path.join(staged, entry.name), {
        recursive: true,
      });
  }
  const client = path.resolve("dist/client");
  const clientRelative = "desktop/dist/client";
  await rm(path.join(staged, "assets", clientRelative), { recursive: true, force: true });
  await cp(client, path.join(staged, "assets", clientRelative), { recursive: true });
  const fixture = path.join(staged, "assets", "promotion-smoke");
  await build({
    configFile: false,
    build: {
      outDir: fixture,
      target: "esnext",
      rollupOptions: {
        external: ["/tuffite.js"],
        input: path.resolve("smoke/explorer-promotion-fixture.tsx"),
        output: {
          entryFileNames: "explorer-promotion-fixture.js",
          assetFileNames: "[name].[ext]",
        },
      },
    },
    logLevel: "warn",
  });
  const fixtureStyles = (await readdir(fixture)).filter((name) => name.endsWith(".css"));
  await writeFile(
    path.join(fixture, "index.html"),
    `<!doctype html><style>body{margin:0;font-family:system-ui;background:#201638;--surface:#f7f7f8;--background:#fff;--text:#222;--muted-foreground:#555;--line-strong:#ddd;--app-pane-radius:12px}explorer{display:block;width:100%;height:100%}[data-tool-surface]>div{height:100%;width:100%}.app-shell{position:relative;width:100vw;height:100vh}</style>${fixtureStyles.map((name) => `<link rel="stylesheet" href="/promotion-smoke/${name}">`).join("")}<div id="root" class="app-shell"></div><script nonce="ovule-spa">window.nativePromotionTarget=${JSON.stringify(sample)}</script><script type="module" src="/promotion-smoke/explorer-promotion-fixture.js"></script>`,
  );
  const configPath = path.join(staged, "tuffite.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const runtimeFixture = JSON.parse(
    await readFile(new URL("./fixtures/runtime.json", import.meta.url), "utf8"),
  );
  Object.assign(config.app, runtimeFixture.app);
  config.browser = runtimeFixture.browser;
  config.app.windows[0].url = "ovule://-/promotion-smoke/index.html";
  config.app.assets.push({
    origins: ["ovule://-"],
    paths: ["/promotion-smoke/*"],
    directory: "promotion-smoke",
  });
  await writeFile(configPath, JSON.stringify(config, null, 2));
  const portServer = http.createServer();
  await listen(portServer);
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  await mkdir(path.join(output, "data"));
  await mkdir(path.join(output, "profile"));
  application = spawn(
    path.join(staged, process.platform === "win32" ? "ovule.exe" : "ovule"),
    [
      "--lang=en-US",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(output, "profile")}`,
      `--log-file=${path.join(output, "tuffite.log")}`,
      "--no-first-run",
      "--tuffite-runtime-snapshot",
    ],
    {
      cwd: staged,
      env: { ...process.env, OVULE_DATA_DIR: path.join(output, "data") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const log = [];
  watchdog = setTimeout(() => application.kill("SIGTERM"), 180_000);
  application.stderr.on("data", (data) => log.push(String(data)));
  application.stdout.on("data", (data) => log.push(String(data)));
  await until(async () => {
    if (application.exitCode !== null)
      throw new Error(`Application exited: ${log.join("").slice(-6000)}`);
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
    } catch {
      return false;
    }
  }, "Native CDP endpoint missing").catch((error) => {
    throw new Error(`${error.message}: ${log.join("").slice(-6000)}`);
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const browserSession = await browser.newBrowserCDPSession();
  await browserSession.send("Browser.setDownloadBehavior", { behavior: "default" });
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  await until(
    () => pages().some((page) => page.url().includes("promotion-smoke/index.html")),
    "Native fixture window missing",
  );
  const app = pages().find((page) => page.url().includes("promotion-smoke/index.html"));
  assert.ok(app);
  app.on("pageerror", (error) => errors.push(String(error)));
  const guests = () => pages().filter((page) => page.url().startsWith(sample));
  const sourceSelector = "[data-explorer-preview] explorer";
  const seed = async () => {
    await until(() => guests().length === 1, "Sample page missing");
    const guest = guests()[0];
    await guest.waitForLoadState("load");
    await guest.evaluate(async () => {
      document.querySelector("#draft").value = "unsaved native input";
    });
    await guest.evaluate(async () => history.pushState({}, "", "?step=2"));
    return {
      state: await app.evaluate(async (selector) => {
        const element = document.querySelector(selector);
        window.originalExplorer = element;
        window.migrationLoads = 0;
        element.addEventListener("loadstart", () => window.migrationLoads++);
        return element.getNavigationState();
      }, sourceSelector),
      page: await guest.evaluate(async () => ({
        marker: pageMarker,
        input: document.querySelector("#draft").value,
        history: history.length,
        loads,
      })),
      guest,
    };
  };
  await app.waitForFunction(
    async () => window.promotionTest && document.querySelector("[data-explorer-preview] explorer"),
  );
  for (const placement of ["sidebar", "workbench"]) {
    if (placement === "workbench")
      await app.evaluate(
        async (target) =>
          window.promotionTest.overlays.openExplorer({ target, threadId: "thread-test" }),
        sample,
      );
    const before = await seed();
    if (placement === "sidebar") await app.screenshot({ path: path.join(output, "overlay.png") });
    await app.getByRole("button", { name: `Open in ${placement}`, exact: true }).click();
    await app.waitForFunction(async () => !window.promotionTest.overlays.current().explorer);
    const after = await app.evaluate(async () => {
      const element = document.querySelector("[data-tool-tab] explorer");
      return {
        state: await element.getNavigationState(),
        sourceConnected: window.originalExplorer.isConnected,
        loads: window.migrationLoads,
        tabId: element.closest("[data-tool-tab]").dataset.toolTab,
        rect: element.getBoundingClientRect().toJSON(),
      };
    });
    assert.equal(after.state.documentId, before.state.documentId);
    assert.equal(after.state.rendererProcess.id, before.state.rendererProcess.id);
    assert.equal(after.sourceConnected, false);
    assert.equal(after.loads, 0);
    assert.ok(after.rect.width > 0 && after.rect.height > 0);
    assert.equal(guests().length, 1);
    assert.deepEqual(
      await before.guest.evaluate(async () => ({
        marker: pageMarker,
        input: document.querySelector("#draft").value,
        history: history.length,
        loads,
      })),
      before.page,
    );
    await app.screenshot({ path: path.join(output, `${placement}.png`) });
    await app.evaluate(async (id) => window.promotionTest.explorer.closeTab(id), after.tabId);
    await until(() => guests().length === 0, "Closing tab retained native page");
  }
  await app.evaluate(
    async (target) =>
      window.promotionTest.overlays.openExplorer({ target, threadId: "thread-test" }),
    sample,
  );
  const before = await seed();
  await app.getByRole("button", { name: "Open in independent window", exact: true }).click();
  await app.waitForFunction(async () => !window.promotionTest.overlays.current().explorer);
  const child = pages().find((page) => page.url().includes("/explorer?"));
  assert.ok(child, "Production independent window route missing");
  const state = await child.evaluate(async () =>
    document.querySelector("explorer").getNavigationState(),
  );
  assert.equal(state.documentId, before.state.documentId);
  assert.equal(state.rendererProcess.id, before.state.rendererProcess.id);
  if (process.env.OVULE_RESOURCE_PDF_URL) {
    await child.evaluate(
      async (url) => document.querySelector("explorer").load(url),
      process.env.OVULE_RESOURCE_PDF_URL,
    );
    await child.waitForFunction(async () =>
      document.querySelector(".explorer-pdf canvas[data-rendered]"),
    );
    await child.waitForFunction(
      async (url) => document.querySelector("nav")?.textContent?.includes(url),
      process.env.OVULE_RESOURCE_PDF_URL,
    );
    const downloaded = await child.evaluate(async () =>
      document.querySelector("explorer").getDownloads(),
    );
    assert.ok(
      downloaded.some(
        (item) =>
          item.navigation && item.state === "complete" && item.mimeType === "application/pdf",
      ),
    );
    await child.screenshot({ path: path.join(output, "native-pdf.png") });
    console.log("Production independent Explorer PDF download and canvas passed");
  }
  assert.deepEqual(
    await before.guest.evaluate(async () => ({
      marker: pageMarker,
      input: document.querySelector("#draft").value,
      history: history.length,
      loads,
    })),
    before.page,
  );
  await app
    .evaluate(async () => {
      await import("/tuffite.js");
      await (await import("/tuffite.js")).window.close();
    })
    .catch((error) => {
      if (!/closed|Execution context was destroyed/.test(String(error))) throw error;
    });
  await until(() => app.isClosed(), "Original window did not close");
  assert.equal(guests().length, 1);
  assert.equal(
    (await child.evaluate(async () => document.querySelector("explorer").getNavigationState()))
      .documentId,
    before.state.documentId,
  );
  assert.equal(await before.guest.locator("#draft").inputValue(), "unsaved native input");
  assert.deepEqual(errors, []);
  await child
    .evaluate(async () => {
      await import("/tuffite.js");
      await (await import("/tuffite.js")).window.close();
    })
    .catch((error) => {
      if (!/closed|Execution context was destroyed/.test(String(error))) throw error;
    });
  await until(
    () => application.exitCode !== null,
    "Closing the final window did not exit the application",
  );
  assert.equal(application.exitCode, 0, log.join("").slice(-6000));
  console.log(
    "explorer-promotion-native=ok (sidebar, workbench, production independent window, page state and ownership cleanup)",
  );
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  application?.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
  if (process.env.OVULE_KEEP_SMOKE_FILES) console.log(`smoke-files=${output}`);
  else await rm(output, { recursive: true, force: true });
}
