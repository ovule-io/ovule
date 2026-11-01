import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "vite";
import { chromium } from "playwright-core";
const output = await mkdtemp(path.join(tmpdir(), "ovule-attachments-"));
let server, browser;
try {
  await build({
    configFile: false,
    build: {
      outDir: output,
      target: "esnext",
      rollupOptions: {
        input: path.resolve("smoke/message-attachments-fixture.tsx"),
        output: { entryFileNames: "fixture.js", assetFileNames: "[name].[ext]" },
      },
    },
    logLevel: "error",
  });
  const css = (await readdir(output)).find((file) => file.endsWith(".css"));
  server = createServer(async (req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (req.url === "/") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/${css}"><style>body{padding:32px}#root{max-width:800px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`,
      );
    } else {
      res.setHeader(
        "content-type",
        req.url.endsWith(".css") ? "text/css; charset=utf-8" : "application/javascript",
      );
      res.end(await readFile(path.join(output, path.basename(req.url))));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OVULE_BROWSER_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 940, height: 640 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const preview = page.getByRole("button", { name: "Preview screen.png", exact: true });
  await preview.waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-slot="attachment-media"] img')?.naturalWidth > 0,
  );
  assert.equal(await page.getByRole("group", { name: "Attachments", exact: true }).count(), 1);
  assert.equal(await page.locator('[data-slot="attachment"]').count(), 5);
  assert.equal(await page.getByText("PNG · 2 KB", { exact: true }).count(), 1);
  await preview.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByRole("dialog").getByRole("img", { name: "screen.png" }).count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Open report.pdf", exact: true }).click();
  await page.getByRole("button", { name: "Open archive.zip", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => attachmentTest.events), [
    "office:/workspace/report.pdf",
    "browser:https://example.test/archive.zip",
  ]);
  assert.equal(await page.getByText("Image unavailable", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Open unsafe.txt", exact: true }).count(), 0);
  await page.getByRole("group", { name: "Attachments", exact: true }).evaluate((group) => {
    group.scrollLeft = 0;
  });
  await page.screenshot({ path: "/private/tmp/ovule-message-attachments.png" });
  await page.evaluate(() => attachmentTest.unmount());
  assert.equal(await page.evaluate(() => attachmentTest.revoked.length), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS message attachments: grouped cards, metadata, stored image preview, keyboard, file routing, missing/unsafe sources, blob cleanup",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(output, { recursive: true, force: true });
}
