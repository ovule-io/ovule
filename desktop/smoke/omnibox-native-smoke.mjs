import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, waitHttp, waitFor } from "./runner.mjs";

await main("omnibox-native", async (c) => {
  await c.claimPackage();
  const port = await availablePort(0);
  const endpoint = `http://127.0.0.1:${port}`;
  const child = c.launch(port, { extra: ["--no-first-run"] });
  await waitHttp(`${endpoint}/json/version`, child, undefined, 60000);
  const browser = await chromium.connectOverCDP(endpoint);
  let fixtureServer;
  try {
    const app = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url().startsWith("ovule://-/main")),
      "native main page",
    );
    await app.waitForLoadState("domcontentloaded");
    await app.evaluate(() => localStorage.setItem("ovule.onboarding.dismissed", "true"));
    await app.reload();
    await app.locator('[data-thread-surface="ready"]').waitFor({ timeout: 60000 });
    const settingsButton = app
      .locator(".titlebar")
      .getByRole("button", { name: "Settings", exact: true });
    await settingsButton.click();
    const engine = app.getByRole("combobox", { name: "Default search engine" });
    await engine.click();
    await app.getByRole("option", { name: "Google", exact: true }).click();
    assert.equal(
      await app.evaluate(() => localStorage.getItem("ovule.search.url")),
      "https://www.google.com/search?q=",
    );
    await settingsButton.click();
    await app.reload();
    await app.locator('[data-thread-surface="ready"]').waitFor({ timeout: 60000 });
    await settingsButton.click();
    await engine.waitFor();
    assert.match(await engine.textContent(), /Google/, "native General setting survives reload");
    await app.screenshot({ path: join(c.artifacts, "search-engine-settings.png") });
    await settingsButton.click();
    await app.evaluate(() =>
      window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: {} })),
    );
    const address = () =>
      app.locator('[data-tool-surface][data-active="true"] .browser-empty-omnibox input');
    await address().waitFor();
    await app.waitForFunction(
      () =>
        document.hasFocus() &&
        document.activeElement ===
          document.querySelector('[data-tool-surface][data-active="true"] input'),
    );
    assert.equal(
      await app.locator('[data-tool-surface][data-active="true"] explorer').count(),
      0,
      "blank tab needs no inner WebContents",
    );
    await app.keyboard.type("baidu");
    assert.equal(
      await address().inputValue(),
      "baidu",
      "native keyboard input works without a click",
    );
    const firstTab = await app
      .locator('[data-tool-surface][data-active="true"]')
      .getAttribute("data-tool-tab");
    const expanded = app.locator("[data-omnibox-panel]:popover-open");
    await expanded.getByRole("option").first().waitFor();
    assert.equal(await expanded.locator("input").count(), 1);
    await app.screenshot({ path: join(c.artifacts, "new-tab-expanded.png") });
    await app.getByRole("button", { name: "Add tab", exact: true }).click();
    await app.waitForFunction(
      (previous) =>
        document
          .querySelector('[data-tool-surface][data-active="true"]')
          ?.getAttribute("data-tool-tab") !== previous,
      firstTab,
    );
    await app.waitForFunction(
      () =>
        document.activeElement ===
        document.querySelector('[data-tool-surface][data-active="true"] input'),
    );
    await app.keyboard.type("second tab");
    assert.equal(await address().inputValue(), "second tab");
    await app.locator(".pane-active-tab").hover();
    await app.getByRole("button", { name: "Edit address", exact: true }).click();
    const toolbar = app.locator(".pane-omnibox input");
    await toolbar.fill("baidu");
    const toolbarExpanded = app.locator(".pane-omnibox [data-omnibox-panel]:popover-open");
    await toolbarExpanded.getByRole("option").first().waitFor();
    assert.equal(await toolbarExpanded.locator("input").count(), 1);
    assert.equal(
      await app.locator(".browser-empty-omnibox [data-omnibox-panel]:popover-open").count(),
      0,
      "focusing the toolbar dismisses the previous suggestion panel immediately",
    );
    await app.screenshot({ path: join(c.artifacts, "titlebar-expanded.png") });
    await app.keyboard.press("Escape");
    fixtureServer = createServer((_request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(
        "<!doctype html><title>Native navigation fixture</title><p>Navigation ready</p>",
      );
    });
    await new Promise((resolve) => fixtureServer.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${fixtureServer.address().port}/`;
    await address().fill(target);
    await app.keyboard.press("Enter");
    await app.locator('[data-tool-surface][data-active="true"] explorer').waitFor();
    await app.waitForFunction(async (target) => {
      const explorer = document.querySelector('[data-tool-surface][data-active="true"] explorer');
      return explorer && (await explorer.getNavigationState()).url === target;
    }, target);
    assert.equal(
      await app.locator('[data-tool-surface][data-active="true"] .browser-empty-omnibox').count(),
      0,
      "navigation replaces the blank UI with the native Explorer",
    );
    console.log(
      "PASS Native Omnibox: direct keyboard typing after New Tab, native tab switching, no blank-page WebContents, unified new-tab/titlebar suggestions",
    );
  } finally {
    await browser.close();
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
  }
});
