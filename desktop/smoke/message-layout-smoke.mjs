import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
const output = await mkdtemp(path.join(os.tmpdir(), "ovule-message-layout-"));
await build({
  configFile: false,
  base: "./",
  plugins: [tailwindcss()],
  build: {
    outDir: output,
    target: "esnext",
    rollupOptions: {
      input: path.resolve("smoke/message-layout-fixture.tsx"),
      output: { entryFileNames: "fixture.js", assetFileNames: "[name].[ext]" },
    },
  },
  logLevel: "error",
});
const css = (await readdir(output)).filter((file) => file.endsWith(".css"));
await writeFile(
  path.join(output, "index.html"),
  `<!doctype html><html data-surface="thread" data-theme="light"><head>${css.map((file) => `<link rel="stylesheet" href="./${file}">`).join("")}</head><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.OVULE_BROWSER_PATH,
  headless: true,
  args: ["--allow-file-access-from-files"],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [576, 900, 1200]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(pathToFileURL(path.join(output, "index.html")).href);
    const block = page.locator('[data-slot="code-block"]');
    await block.waitFor();
    await block.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-streamdown="code-block-body"] code span span')].some(
        (token) =>
          token.style.getPropertyValue("--sdm-c") !== "" &&
          token.style.getPropertyValue("--sdm-c") !== "inherit",
      ),
    );
    const originalCode = await block
      .locator("code > span")
      .allTextContents()
      .then((lines) => lines.join("\n"));
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copiedCode = text;
          },
        },
      });
    });
    await page.getByRole("button", { name: "Copy code", exact: true }).click();
    assert.equal(await page.evaluate(() => window.copiedCode), originalCode + "\n");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    const saved = await page.evaluate(() => window.savedCode);
    assert.equal(saved.options.defaultPath, "code.xml");
    assert.equal(new TextDecoder().decode(new Uint8Array(saved.contents)), originalCode + "\n");
    const colors = await block
      .locator("code span span")
      .evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color));
    await page.locator("html").evaluate((html) => (html.dataset.theme = "dark"));
    const darkColors = await block
      .locator("code span span")
      .evaluateAll((tokens) => tokens.map((token) => getComputedStyle(token).color));
    assert.notDeepEqual(colors, darkColors);
    await page.locator("html").evaluate((html) => (html.dataset.theme = "light"));
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="message-card"]');
      const block = document.querySelector('[data-slot="code-block"]');
      const body = document.querySelector('[data-streamdown="code-block-body"]');
      const pre = body.querySelector("pre");
      return {
        cardWidth: card.clientWidth,
        cardScroll: card.scrollWidth,
        blockRight: block.getBoundingClientRect().right,
        cardRight: card.getBoundingClientRect().right,
        localScroll: body.scrollWidth > body.clientWidth,
        bodyWidth: body.clientWidth,
        bodyScroll: body.scrollWidth,
        codeText: pre.textContent.length,
        whiteSpace: getComputedStyle(pre.querySelector("code")).whiteSpace,
        borders: [block, body, pre].map((element) => getComputedStyle(element).borderTopWidth),
      };
    });
    assert.ok(geometry.cardScroll <= geometry.cardWidth + 1, JSON.stringify(geometry));
    assert.ok(geometry.blockRight <= geometry.cardRight, JSON.stringify(geometry));
    assert.equal(geometry.localScroll, true, "Long XML scrolls inside the code block");
    assert.deepEqual(geometry.borders, ["1px", "0px", "0px"]);
    const wrap = page.getByRole("button", { name: "Wrap lines", exact: true });
    await wrap.click();
    await page.waitForFunction(() => {
      const body = document.querySelector('[data-streamdown="code-block-body"]');
      return body.scrollWidth <= body.clientWidth + 1;
    });
    assert.equal(await wrap.getAttribute("aria-pressed"), "true");
    await wrap.click();
    assert.deepEqual(
      await page
        .locator("[data-tab-id]")
        .evaluateAll((tabs) => tabs.map((tab) => tab.dataset.tabId)),
      ["tab-4", "tab-3", "tab-2"],
    );
    await page.getByRole("button", { name: "Show all tabs", exact: true }).click();
    await page.getByRole("menuitem", { name: "Tab 1", exact: true }).click();
    assert.deepEqual(
      await page
        .locator("[data-tab-id]")
        .evaluateAll((tabs) => tabs.map((tab) => tab.dataset.tabId)),
      ["tab-1", "tab-4", "tab-3"],
    );
    await page.screenshot({ path: path.join(output, `message-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    `message_layout=ok widths=576,900,1200 single_code_border=true local_code_scroll=true recent_three_tabs=true artifacts=${output}`,
  );
} finally {
  await browser.close();
}
