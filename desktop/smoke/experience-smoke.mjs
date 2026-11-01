import { clientDirectives } from "../scripts/client-directives-plugin.mjs";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
const output = await mkdtemp(path.join(tmpdir(), "ovule-experience-"));
let server, browser;
try {
  await build({
    configFile: false,
    plugins: [clientDirectives(), tailwindcss()],
    build: {
      outDir: output,
      target: "esnext",
      rollupOptions: {
        external: ["/tuffite.js"],
        input: path.resolve("smoke/experience-fixture.tsx"),
        output: { entryFileNames: "fixture.js", assetFileNames: "[name].[ext]" },
      },
    },
    logLevel: "error",
  });
  const css = (await readdir(output)).filter((file) => file.endsWith(".css"));
  server = createServer(async (req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (new URL(req.url, "http://fixture").pathname === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><meta charset="utf-8">${css.map((file) => `<link rel="stylesheet" href="/${file}">`).join("")}<style>html,body{margin:0}#root{height:560px;width:min(860px,100vw)}.timeline{height:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`,
      );
    } else {
      try {
        res.setHeader(
          "content-type",
          req.url.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript",
        );
        res.end(await readFile(path.join(output, new URL(req.url, "http://fixture").pathname)));
      } catch {
        res.writeHead(404).end();
      }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OVULE_BROWSER_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 920, height: 660 } });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("pageerror:", error.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const address = page.getByRole("combobox", { name: "Address or search" });
  await address.waitFor();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ovule:pane-command", {
        detail: {
          tabId: "unrelated-pane",
          action: "browser.navigate:file:///Users/test/Downloads/",
        },
      }),
    ),
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.evaluate(() => experience.panes.current().instances[0].target),
    undefined,
    "an active New Tab ignores another pane's navigation command",
  );
  assert.equal(await address.evaluate((input) => document.activeElement === input), true);
  for (const label of ["Local files", "Terminal", "Workflow", "Remote Host"])
    assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 1, label);
  assert.equal(await page.getByRole("button", { name: "Browser", exact: true }).count(), 0);
  const layout = await page.locator(".browser-empty-omnibox, nav button").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  assert.equal(layout.length, 5);
  for (let index = 1; index < layout.length; index++) {
    assert.ok(
      layout[index].y > layout[index - 1].y + layout[index - 1].height,
      "menus form a vertical stack",
    );
    assert.ok(
      Math.abs(layout[index].width - layout[0].width) < 1,
      "input and actions have matching width",
    );
  }
  assert.equal(
    await address.evaluate((input) => getComputedStyle(input).borderWidth),
    "0px",
    "input has no nested border",
  );
  assert.notEqual(
    await page
      .locator(".browser-empty-omnibox")
      .evaluate((node) => getComputedStyle(node).boxShadow),
    "none",
    "focused search has a glow",
  );
  await address.evaluate((input) => (window.originalOmniboxInput = input));
  await address.fill("baidu");
  await page.getByRole("option", { name: /Search baidu/ }).waitFor();
  const expanded = page.locator("[data-omnibox-panel]:popover-open");
  assert.equal(await expanded.count(), 1, "one unified input and results panel");
  assert.equal(await expanded.locator("input").count(), 1);
  assert.equal(await expanded.getByRole("listbox").count(), 1);
  assert.equal(
    await address.evaluate(
      (input) => input === window.originalOmniboxInput && document.activeElement === input,
    ),
    true,
    "expanding retains the input DOM node and caret",
  );
  assert.equal(await expanded.getByText(/Search Search/).count(), 0);
  await page.screenshot({ path: "/private/tmp/ovule-omnibox-expanded-light.png" });
  await page.keyboard.press("Escape");
  assert.equal(await expanded.count(), 0);
  assert.equal(await address.inputValue(), "baidu", "Escape preserves typed text");
  await address.fill("");
  await page.screenshot({ path: "/private/tmp/ovule-new-tab-light.png" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.waitForTimeout(220);
  assert.equal(
    await page
      .getByRole("button", { name: "Terminal", exact: true })
      .evaluate((button) => getComputedStyle(button).color),
    await address.evaluate((input) => getComputedStyle(input).color),
    "dark theme keeps menu text readable",
  );
  await page.screenshot({ path: "/private/tmp/ovule-new-tab-dark.png" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.getByRole("button", { name: "Add tab", exact: true }).click();
  await page.waitForFunction(() => experience.panes.current().instances.length === 2);
  assert.equal(
    await page.getByRole("menu").count(),
    0,
    "plus opens a page without an add dropdown",
  );
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
  await page.getByRole("button", { name: "Local files", exact: true }).click();
  await page.waitForFunction(() => experience.dialogs === 1);
  assert.equal(
    await page.evaluate(() => experience.panes.current().instances.length),
    2,
    "cancelling file selection creates no tab",
  );
  await page.evaluate(() => (experience.path = "/tmp/ovule #experience%?/目录/config.yaml"));
  await page.getByRole("button", { name: "Local files", exact: true }).click();
  await page.locator('[data-opened-kind="browser"]').waitFor();
  assert.equal(
    await page.evaluate(() => experience.panes.current().instances.at(-1).target),
    "file:///tmp/ovule%20%23experience%25%3F/%E7%9B%AE%E5%BD%95/config.yaml",
  );
  await page.locator(".pane-active-tab").hover();
  await page.getByRole("button", { name: "Edit address", exact: true }).click();
  const toolbarAddress = page.locator(".pane-omnibox input");
  await toolbarAddress.fill("baidu");
  await page.getByRole("option", { name: /Search baidu/ }).waitFor();
  const toolbarExpanded = page.locator("[data-omnibox-panel]:popover-open");
  assert.equal(
    await toolbarExpanded.locator("input").count(),
    1,
    "titlebar uses the same unified panel",
  );
  assert.equal(await toolbarExpanded.getByRole("listbox").count(), 1);
  await page.screenshot({ path: "/private/tmp/ovule-titlebar-omnibox-expanded.png" });
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    experience.panes.selectTab(
      experience.panes.current().instances.findLast((tab) => tab.kind === "browser" && !tab.target)
        .id,
    ),
  );
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: /HOME/ }).click();
  await page.locator('[data-opened-kind="terminal"]').waitFor();
  await page.evaluate(() =>
    experience.panes.selectTab(
      experience.panes.current().instances.findLast((tab) => tab.kind === "browser" && !tab.target)
        .id,
    ),
  );
  await page.getByRole("button", { name: "Remote Host", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: /Test remote/ }).click();
  await page.locator('[data-opened-kind="spice"]').waitFor();
  await page.evaluate(() =>
    experience.panes.selectTab(
      experience.panes.current().instances.findLast((tab) => tab.kind === "browser" && !tab.target)
        .id,
    ),
  );
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page.locator('[data-opened-kind="workflow"]').waitFor();
  const boundary = await browser.newPage({ viewport: { width: 920, height: 660 } });
  boundary.on("pageerror", (error) => errors.push(error.message));
  await boundary.goto(`http://127.0.0.1:${server.address().port}/?boundary=1`);
  const activeAddress = () =>
    boundary.locator('[data-tool-surface][data-active="true"] .browser-empty-omnibox input');
  await activeAddress().waitFor();
  await boundary.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
  assert.equal(
    await boundary.locator("iframe, explorer").count(),
    0,
    "blank new tabs do not create a nested renderer",
  );
  await boundary.keyboard.type("focus before switch");
  await boundary.getByRole("button", { name: "Add tab", exact: true }).click();
  await boundary.waitForFunction(() => experience.panes.current().instances.length === 2);
  await boundary.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[data-tool-surface][data-active="true"] input'),
  );
  await boundary.keyboard.type("new tab receives typing");
  assert.equal(await activeAddress().inputValue(), "new tab receives typing");
  await boundary.evaluate(() =>
    experience.panes.selectTab(experience.panes.current().instances[0].id),
  );
  await boundary.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector('[data-tool-surface][data-active="true"] input'),
  );
  assert.equal(
    await activeAddress().inputValue(),
    "focus before switch",
    "reactivation preserves the draft and places the caret in it",
  );
  await activeAddress().fill("old query");
  await boundary.getByRole("option", { name: /Search old query/ }).waitFor();
  await boundary.evaluate(() => (experience.suggestionDelay = 500));
  await activeAddress().fill("https://fresh.example");
  assert.equal(
    await boundary.locator("[data-omnibox-panel]:popover-open").count(),
    1,
    "pending suggestions keep the unified panel steady",
  );
  assert.equal(
    await boundary.getByRole("option").first().getAttribute("aria-selected"),
    "false",
    "old query results cannot be accepted as the new query",
  );
  await boundary.keyboard.press("Enter");
  await boundary.waitForFunction(
    () =>
      experience.panes
        .current()
        .instances.find((tab) => tab.id === experience.panes.current().activeWorkbenchPaneId)
        ?.target === "https://fresh.example/",
  );
  await boundary.close();
  const searchContext = await browser.newContext({ viewport: { width: 920, height: 660 } });
  const configured = await searchContext.newPage();
  configured.on("pageerror", (error) => errors.push(error.message));
  await configured.goto(`http://127.0.0.1:${server.address().port}/?boundary=1`);
  await configured.locator(".browser-empty-omnibox input").waitFor();
  const settings = await searchContext.newPage();
  settings.on("pageerror", (error) => errors.push(error.message));
  await settings.goto(`http://127.0.0.1:${server.address().port}/?settings=1`);
  const engine = settings.getByRole("combobox", { name: "Default search engine" });
  for (const [label, id, url] of [
    ["Google", "google", "https://www.google.com/search?q="],
    ["Baidu", "baidu", "https://www.baidu.com/s?wd="],
    ["DuckDuckGo", "duckduckgo", "https://duckduckgo.com/?q="],
    ["Bing", "bing", "https://www.bing.com/search?q="],
    ["Google", "google", "https://www.google.com/search?q="],
  ]) {
    await engine.click();
    await settings.getByRole("option", { name: label, exact: true }).click();
    assert.equal(await settings.evaluate(() => localStorage.getItem("ovule.search.url")), url);
    await configured.waitForFunction(
      (id) => experience.preferences.current().searchEngine === id,
      id,
    );
  }
  await settings.screenshot({ path: "/private/tmp/ovule-search-engine-settings.png" });
  await configured.bringToFront();
  await configured.locator(".browser-empty-omnibox input").fill("snow & clouds");
  await configured.keyboard.press("Enter");
  await configured.waitForFunction(
    () =>
      experience.panes.current().instances.at(-1)?.target ===
      "https://www.google.com/search?q=snow%20%26%20clouds",
  );
  await configured.locator(".pane-active-tab").hover();
  await configured.getByRole("button", { name: "Edit address", exact: true }).click();
  await configured.locator(".pane-omnibox input").fill("titlebar words");
  await configured.keyboard.press("Enter");
  await configured.waitForFunction(
    () => experience.lastLoaded === "https://www.google.com/search?q=titlebar%20words",
  );
  await settings.reload();
  await engine.waitFor();
  assert.match(await engine.textContent(), /Google/, "selection survives reload");
  await configured.reload();
  await configured.waitForFunction(
    () => experience.preferences.current().searchEngine === "google",
  );
  await configured.close();
  await settings.close();
  await searchContext.close();
  const restoreContext = await browser.newContext({ viewport: { width: 920, height: 660 } });
  const restored = await restoreContext.newPage();
  restored.on("pageerror", (error) => errors.push(error.message));
  await restored.addInitScript(() => {
    if (localStorage.getItem("ovule.workbench.tabs")) return;
    localStorage.setItem(
      "ovule.workbench.tabs",
      JSON.stringify({
        tabs: [
          {
            id: "browser-empty",
            kind: "browser",
            title: "Downloads",
            url: "file:///Users/test/Downloads/",
            requestVersion: 0,
          },
          {
            id: "browser-web",
            kind: "browser",
            title: "Saved page",
            target: "file:///Users/test/Downloads/",
            url: "https://example.com/latest",
            autoLoad: true,
            requestVersion: 4,
          },
          {
            id: "browser-file",
            kind: "browser",
            title: "config.yaml",
            target: "file:///Users/test/Downloads/",
            url: "file:///tmp/project/config.yaml",
            autoLoad: true,
            requestVersion: 2,
          },
        ],
        activeId: "browser-web",
      }),
    );
  });
  await restored.goto(`http://127.0.0.1:${server.address().port}/?boundary=1&restore=1`);
  await restored.locator('[data-tool-tab="browser-web"] explorer').waitFor();
  assert.equal(
    await restored.locator('[data-tool-tab="browser-web"] explorer').evaluate((node) => node.src),
    "https://example.com/latest",
  );
  assert.deepEqual(
    await restored.evaluate(() => experience.loads),
    [],
    "restoration must not replay the original Downloads navigation",
  );
  assert.equal(
    await restored.getByRole("button", { name: "Edit address", exact: true }).textContent(),
    "example.com",
  );
  await restored.reload();
  await restored.locator('[data-tool-tab="browser-web"] explorer').waitFor();
  assert.deepEqual(await restored.evaluate(() => experience.loads), []);
  await restored.evaluate(() => experience.panes.selectTab("browser-file"));
  const restoredFile = restored.locator('[data-tool-tab="browser-file"] explorer');
  await restoredFile.waitFor();
  const fileSource = await restoredFile.evaluate((node) => node.src);
  assert.equal(new URL(fileSource).pathname, "/local-code");
  assert.equal(new URL(fileSource).searchParams.get("url"), "file:///tmp/project/config.yaml");
  assert.equal(await restored.getByRole("button", { name: "config.yaml", exact: true }).count(), 1);
  assert.deepEqual(await restored.evaluate(() => experience.loads), []);
  // An in-flight old document response cannot overwrite a later address request.
  await restored.evaluate(() => {
    experience.holdMetadata = true;
    document
      .querySelector('[data-tool-tab="browser-file"] explorer')
      .dispatchEvent(new CustomEvent("loadcommit"));
  });
  await restored.waitForFunction(() => experience.pendingMetadata.length > 0);
  await restored.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ovule:pane-command", {
        detail: { tabId: "browser-file", action: "browser.navigate:file:///tmp/project/next.yaml" },
      }),
    ),
  );
  await restored.waitForFunction(() =>
    document.querySelector('[data-tool-tab="browser-file"] explorer')?.src?.includes("next.yaml"),
  );
  await restored.evaluate(() => {
    experience.holdMetadata = false;
    for (const resolve of experience.pendingMetadata.splice(0)) resolve();
  });
  assert.notEqual(
    await restored.evaluate(
      () => experience.panes.current().instances.find((tab) => tab.id === "browser-file").url,
    ),
    "file:///tmp/project/config.yaml",
  );
  assert.equal(
    new URL(
      await restored
        .locator('[data-tool-tab="browser-file"] explorer')
        .evaluate((node) => node.src),
    ).searchParams.get("url"),
    "file:///tmp/project/next.yaml",
  );
  assert.equal(
    await restored.evaluate(
      () => experience.panes.current().instances.find((tab) => tab.id === "browser-empty").target,
    ),
    undefined,
    "hidden New Tab was not navigated by the file pane command",
  );
  const previousFileSurface = await restored
    .locator('[data-tool-tab="browser-file"] explorer')
    .elementHandle();
  await restored.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ovule:pane-command", {
        detail: {
          tabId: "browser-file",
          action: "browser.navigate:file:///tmp/project/archive.zip",
        },
      }),
    ),
  );
  await restored.waitForFunction(() =>
    document
      .querySelector('[data-tool-tab="browser-file"] explorer')
      ?.src?.includes("local-unsupported"),
  );
  assert.equal(
    await previousFileSurface.evaluate((node) => node.isConnected),
    true,
    "file selection retains the native Explorer and its history",
  );
  assert.equal(
    new URL(
      await restored
        .locator('[data-tool-tab="browser-file"] explorer')
        .evaluate((node) => node.src),
    ).searchParams.get("url"),
    "file:///tmp/project/archive.zip",
  );
  for (const [action, expected] of [
    ["browser.back", "next.yaml"],
    ["browser.forward", "archive.zip"],
  ]) {
    await restored.evaluate(
      (action) =>
        window.dispatchEvent(
          new CustomEvent("ovule:pane-command", { detail: { tabId: "browser-file", action } }),
        ),
      action,
    );
    await restored.waitForFunction((name) => {
      const source = document.querySelector('[data-tool-tab="browser-file"] explorer')?.src;
      return source && new URL(source).searchParams.get("url")?.endsWith(name);
    }, expected);
  }
  await restored.evaluate(() => experience.panes.selectTab("browser-empty"));
  await restored.reload();
  await restored.locator(".browser-empty-omnibox input").waitFor();
  assert.equal(
    await restored.locator(".cm-file-breadcrumb").count(),
    0,
    "blank New Tab stays blank after restart",
  );
  assert.equal(
    await restored.evaluate(() => experience.panes.current().activeWorkbenchPaneId),
    "browser-empty",
  );
  await restored.close();
  await restoreContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS Experience: New Tab focus and actions, file selection/cancel, search preferences, restored blank/web/code tabs, no stale request replay and cross-tab command isolation",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(output, { recursive: true, force: true });
}
