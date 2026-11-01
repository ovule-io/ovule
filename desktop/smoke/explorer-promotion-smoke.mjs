import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { build } from "vite";

const output = await mkdtemp(path.join(os.tmpdir(), "ovule-promotion-"));
await build({
  configFile: false,
  base: "./",
  build: {
    outDir: output,
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
const stylesheets = (await readdir(output)).filter((file) => file.endsWith(".css"));
await writeFile(
  path.join(output, "index.html"),
  `<!doctype html><style>body{margin:0;font-family:system-ui;background:#201638;--surface:#f7f7f8;--background:#fff;--text:#222;--muted-foreground:#555;--line-strong:#ddd;--app-pane-radius:12px}test-explorer{background:#e8e7e3;display:block;width:100%;height:100%}[data-tool-surface]>div{height:100%;width:100%}.app-shell{position:relative;width:100vw;height:100vh;backdrop-filter:blur(28px)}</style>${stylesheets.map((file) => `<link rel="stylesheet" href="./${file}">`).join("")}<div id="root" class="app-shell"></div><script type="module" src="./explorer-promotion-fixture.js"></script>`,
);
const browser = await chromium.launch({
  executablePath:
    process.env.OVULE_BROWSER_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(String(error));
    console.error(error);
  });
  await page.goto(pathToFileURL(path.join(output, "index.html")).href);
  for (const placement of ["workbench", "sidebar"]) {
    await page.emulateMedia({
      reducedMotion: placement === "sidebar" ? "reduce" : "no-preference",
    });
    if (placement === "sidebar")
      await page.evaluate(() =>
        window.promotionTest.overlays.openExplorer({
          target: "https://example.com/start",
          threadId: "thread-test",
          navigation: "allow",
        }),
      );
    await page.waitForFunction(() =>
      document.querySelector("[data-explorer-preview]:not([data-explorer-tab]) test-explorer"),
    );
    const clipping = await page.evaluate(() => {
      const frame = document.querySelector("[data-explorer-preview]:not([data-explorer-tab])");
      const panel = frame.querySelector("[data-explorer-panel]");
      const rect = panel.getBoundingClientRect();
      const corners = [
        [rect.left + 1, rect.bottom - 1],
        [rect.right - 1, rect.bottom - 1],
      ];
      return corners.every(([x, y]) => !panel.contains(document.elementFromPoint(x, y)));
    });
    assert.equal(clipping, true, "The complete panel clips both bottom corners");
    const toolbar = await page.evaluate(() => {
      const panel = document.querySelector("[data-explorer-preview]:not([data-explorer-tab])");
      const buttons = [...panel.querySelectorAll("button")];
      const bar = buttons
        .find((button) => button.getAttribute("aria-label") === "Go back")
        .closest("div");
      const actions = buttons.filter((button) =>
        ["Close", "Open in sidebar", "Open in workbench", "Open in independent window"].includes(
          button.getAttribute("aria-label"),
        ),
      );
      return {
        height: bar.getBoundingClientRect().height,
        buttonCount: bar.querySelectorAll("button").length,
        buttonHeights: [...bar.querySelectorAll("button")].map(
          (button) => button.getBoundingClientRect().height,
        ),
        panelRight: panel.getBoundingClientRect().right,
        actions: actions.map((button) => button.getBoundingClientRect().toJSON()),
      };
    });
    assert.equal(toolbar.height, 28);
    assert.equal(toolbar.buttonCount, 4);
    assert.ok(toolbar.buttonHeights.every((height) => height <= 28));
    assert.equal(toolbar.actions.length, 4);
    assert.ok(toolbar.actions.every((rect) => rect.width === 28 && rect.height === 28));
    assert.ok(toolbar.actions.every((rect) => rect.left > toolbar.panelRight));
    assert.ok(
      toolbar.actions[0].top < toolbar.actions[1].top &&
        toolbar.actions[1].top < toolbar.actions[2].top &&
        toolbar.actions[2].top < toolbar.actions[3].top,
    );
    const copyButton = page.getByRole("button", { name: "Copy URL", exact: true });
    await copyButton.hover();
    await page
      .getByRole("tooltip")
      .filter({ hasText: /^Copy URL$/ })
      .waitFor();
    await copyButton.click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Copied", exact: true }).getAttribute("data-feedback"),
      "success",
    );
    const promotionButton = page.getByRole("button", { name: "Open in workbench", exact: true });
    await promotionButton.hover();
    await page
      .getByRole("tooltip")
      .filter({ hasText: /^Open in workbench$/ })
      .waitFor();
    assert.equal(await page.evaluate(() => window.copiedUrl), "https://example.com/current");
    if (process.env.OVULE_PROMOTION_SCREENSHOT && placement === "workbench")
      await page.screenshot({ path: process.env.OVULE_PROMOTION_SCREENSHOT });
    await page.evaluate(() => {
      window.originalClipboardWriter = navigator.clipboard.writeText;
      window.originalExecCommand = document.execCommand;
      navigator.clipboard.writeText = async () => {
        throw new Error("Clipboard denied");
      };
      document.execCommand = () => false;
    });
    await page.getByRole("button", { name: "Copied", exact: true }).click();
    await page.getByRole("button", { name: "Action failed. Try again.", exact: true }).waitFor();
    await page.evaluate(() => {
      navigator.clipboard.writeText = window.originalClipboardWriter;
      document.execCommand = window.originalExecCommand;
    });
    let before = await page.evaluate(() => {
      window.originalExplorer = document.querySelector(
        "[data-explorer-preview]:not([data-explorer-tab]) test-explorer",
      );
      return { ...window.promotionTest.lifecycle };
    });
    // A stale native library must fail before creating a new loaded guest.
    // An open modal drawer also disables body hit testing; the overlay must
    // remain clickable above it.
    await page.evaluate(() => {
      document.body.style.pointerEvents = "none";
      Object.defineProperty(window.originalExplorer, "detach", {
        value: undefined,
        configurable: true,
      });
    });
    await page.getByRole("button", { name: "Open in workbench", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Update the Tuffite runtime" }).waitFor();
    assert.equal(await page.evaluate(() => window.promotionTest.lifecycle.created), before.created);
    await page.evaluate(() => {
      delete window.originalExplorer.detach;
      window.promotionTest.transferControl.failNextAttach = true;
      if (!window.assertDetachedBeforeOpen) {
        const panes = window.promotionTest.explorer;
        const open = panes.openTab.bind(panes);
        panes.openTab = (...args) => {
          if (window.originalExplorer.page)
            throw new Error("Source must detach before target activation");
          return open(...args);
        };
        window.assertDetachedBeforeOpen = true;
      }
    });
    await page.getByRole("button", { name: "Open in workbench", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Simulated destination attach failure" })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.originalExplorer.liveValue),
      "unsaved form input",
    );
    assert.equal(
      await page
        .locator("[data-explorer-preview]")
        .evaluate((panel) => getComputedStyle(panel).opacity),
      "1",
    );
    before = await page.evaluate(() => {
      window.promotionTest.paint.blocked = true;
      const source = window.originalExplorer;
      source.getNavigationState = () =>
        new Promise((resolve) => {
          window.releaseNavigation = async () => {
            delete source.getNavigationState;
            resolve(await source.getNavigationState());
          };
        });
      return { ...window.promotionTest.lifecycle };
    });
    await page
      .getByRole("button", {
        name:
          placement === "workbench"
            ? /Open in workbench|在工作台中打开/
            : /Open in sidebar|在侧边栏中打开/,
      })
      .click();
    await page.locator('[data-explorer-preview][aria-busy="true"]').waitFor();
    assert.equal(await page.getByRole("button", { name: "Close", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.promotionTest.lifecycle.created), before.created);
    await page.evaluate(() => window.releaseNavigation());
    await page.waitForFunction(() => !window.promotionTest.overlays.current().explorer);
    // Destination rendering must not hold the source modal open. Keep the
    // screenshot visible there while the native compositor is deliberately stalled.
    await page.waitForFunction(() => window.promotionTest.paint.waiting);
    assert.equal(await page.locator("[data-explorer-preview]").count(), 0);
    assert.equal(await page.locator("[data-tool-tab] .explorer-transfer-preview").count(), 1);
    await page.evaluate(() => window.promotionTest.paint.release());
    if (placement === "workbench") {
      await page.waitForFunction(
        () =>
          document.querySelector("[data-tool-tab] .explorer-transfer-preview")?.getAnimations()
            .length,
      );
    }
    await page.waitForFunction(() => !document.querySelector(".explorer-transfer-preview"));
    await page.evaluate(() => {
      document.body.style.pointerEvents = "";
    });
    const result = await page.evaluate(() => {
      const original = window.originalExplorer;
      const element = [...document.querySelectorAll("[data-tool-tab] test-explorer")].at(-1);
      window.transferredExplorer = element;
      const tabId = element.closest("[data-tool-tab]")?.dataset.toolTab;
      const tab = window.promotionTest.explorer
        .current()
        .instances.find((item) => item.id === tabId);
      return {
        connected: element.isConnected,
        identity: element !== original && !original.isConnected,
        value: element.liveValue,
        history: element.history,
        tab,
        lifecycle: { ...window.promotionTest.lifecycle },
        rect: element.getBoundingClientRect().toJSON(),
      };
    });
    assert.equal(result.connected, true);
    assert.equal(result.identity, true);
    assert.equal(result.value, "unsaved form input");
    assert.deepEqual(result.history, ["https://example.com/start", "https://example.com/current"]);
    assert.equal(result.lifecycle.loads, before.loads);
    assert.equal(result.lifecycle.reloads, before.reloads);
    assert.equal(result.lifecycle.detaches, before.detaches + 1);
    assert.equal(result.lifecycle.attaches, before.attaches + 1);
    assert.equal(result.lifecycle.created, before.created + 1);
    const after = result.lifecycle;
    assert.equal(result.tab.placement, placement === "sidebar" ? "thread" : "workbench");
    assert.equal(result.tab.autoLoad, false);
    assert.equal(result.tab.url, "https://example.com/current");
    assert.equal(result.rect.width, 640);
    await page.evaluate(() => window.promotionTest.setDrawerOpen(true));
    await page.getByRole("button", { name: "Close sidebar", exact: true }).waitFor();
    await page.waitForFunction(() => {
      const drawer = document.querySelector(".ui-drawer-content");
      return drawer?.contains(document.elementFromPoint(40, 100));
    });
    assert.equal(
      await page.evaluate(() =>
        document.querySelector(".ui-drawer-overlay")?.contains(document.elementFromPoint(400, 150)),
      ),
      true,
    );
    assert.deepEqual(await page.evaluate(() => ({ ...window.promotionTest.lifecycle })), after);
    await page.getByRole("button", { name: "Close sidebar", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".ui-drawer-content"));
    await page.evaluate((tabId) => {
      const target = document.querySelector(`[data-tool-tab="${tabId}"]`);
      target.dataset.active = "false";
    }, result.tab.id);

    await page.evaluate((tabId) => {
      const target = document.querySelector(`[data-tool-tab="${tabId}"]`);
      target.dataset.active = "true";
      target.style.width = "500px";
    }, result.tab.id);
    await page.waitForFunction(
      () => window.transferredExplorer.getBoundingClientRect().width === 500,
    );
    assert.deepEqual(await page.evaluate(() => ({ ...window.promotionTest.lifecycle })), after);
    await page.evaluate(
      (tabId) =>
        window.dispatchEvent(
          new CustomEvent("ovule:pane-command", { detail: { tabId, action: "browser.reload" } }),
        ),
      result.tab.id,
    );
    assert.equal(
      await page.evaluate(() => window.promotionTest.lifecycle.reloads),
      before.reloads + 1,
    );
    await page.evaluate(
      (tabId) =>
        window.promotionTest.explorer.updateTab(tabId, {
          target: "example.com/explicit",
          requestVersion: 1,
        }),
      result.tab.id,
    );
    await page.waitForFunction(
      () => window.transferredExplorer.history.at(-1) === "https://example.com/explicit",
    );
  }
  // The initial transfer marker must not leave later retries as empty hosts.
  await page.evaluate(() => window.transferredExplorer.dispatchEvent(new Event("loaderror")));
  await page.getByRole("button", { name: "Reload pane", exact: true }).click();
  await page.waitForFunction(() => {
    const element = [...document.querySelectorAll("[data-tool-tab] test-explorer")].at(-1);
    if (!element || element === window.transferredExplorer) return false;
    const tabId = element.closest("[data-tool-tab]").dataset.toolTab;
    const tab = window.promotionTest.explorer.current().instances.find((item) => item.id === tabId);
    return !element.deferred && element.src === (tab.url || tab.target);
  });
  const disconnected = await page.evaluate(() => window.promotionTest.lifecycle.disconnected);
  await page.evaluate(() => {
    for (const tab of window.promotionTest.explorer.current().instances)
      window.promotionTest.explorer.closeTab(tab.id);
  });
  await page.waitForFunction(
    () => Object.keys(window.promotionTest.overlays.current().explorerTabs).length === 0,
  );
  await page.waitForFunction(
    (before) => window.promotionTest.lifecycle.disconnected === before + 2,
    disconnected,
  );
  assert.deepEqual(errors, []);
  console.log(
    "explorer-promotion=ok (early handoff, preview fade, reduced motion, rollback, page lifecycle, toolbar, drawer layering and cleanup verified)",
  );
} finally {
  await browser.close();
  await rm(output, { recursive: true, force: true });
}
