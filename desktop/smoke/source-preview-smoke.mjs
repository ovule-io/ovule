import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
const output = await mkdtemp(path.join(tmpdir(), "ovule-source-preview-"));
let browser;
try {
  await build({
    configFile: false,
    base: "./",
    plugins: [tailwindcss()],
    build: {
      outDir: output,
      target: "esnext",
      rollupOptions: {
        input: path.resolve("smoke/source-preview-fixture.tsx"),
        output: { entryFileNames: "fixture.js", assetFileNames: "[name].[ext]" },
      },
    },
    logLevel: "error",
  });
  const css = (await readdir(output)).filter((file) => file.endsWith(".css"));
  await writeFile(
    path.join(output, "index.html"),
    `<!doctype html><html data-theme="light"><head>${css.map((file) => `<link rel="stylesheet" href="./${file}">`).join("")}</head><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>`,
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.OVULE_BROWSER_PATH ? { executablePath: process.env.OVULE_BROWSER_PATH } : {}),
    args: ["--allow-file-access-from-files"],
  });
  const page = await browser.newPage({ viewport: { width: 850, height: 650 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(output, "index.html")).href);
  await page.waitForFunction(
    () =>
      document.querySelector("[data-preview-image] img")?.complete &&
      document.querySelector("[data-preview-image] img")?.naturalWidth > 0,
  );
  assert.equal(await page.locator("[data-preview-image] img").getAttribute("alt"), "demo.svg");
  const bounds = await page.locator("[data-preview-image] img").boundingBox();
  assert.ok(
    bounds.width <= 320 && bounds.height <= 320,
    "viewBox-only SVG stays within the preview size cap",
  );
  await page.screenshot({ path: "/private/tmp/ovule-svg-preview.png" });
  for (const kind of ["svg", "html", "md"]) {
    await page.getByRole("button", { name: kind, exact: true }).click();
    if (kind === "html")
      await page.frameLocator("iframe").getByRole("heading", { name: "HTML preview" }).waitFor();
    if (kind === "md") await page.getByRole("heading", { name: "Markdown preview" }).waitFor();
    await page.getByRole("button", { name: "Toggle source" }).click();
    const source = page.locator(".preview-code");
    await source.waitFor();
    assert.match(
      await source.textContent(),
      kind === "svg" ? /<svg/ : kind === "html" ? /<h1>/ : /# Markdown/,
    );
    await page.getByRole("button", { name: "Toggle source" }).click();
    await source.waitFor({ state: "detached" });
  }
  assert.equal(
    await page.evaluate(() => Boolean(window.svgExecuted || window.htmlExecuted)),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS SVG renders as an inert image; Markdown, HTML and SVG switch between source and preview",
  );
} finally {
  await browser?.close();
  await rm(output, { recursive: true, force: true });
}
