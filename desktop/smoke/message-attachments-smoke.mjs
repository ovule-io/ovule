import { clientDirectives } from "../scripts/client-directives-plugin.mjs";
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
    plugins: [clientDirectives()],
    build: {
      outDir: output,
      target: "esnext",
      rollupOptions: {
        external: ["/tuffite.js"],
        input: path.resolve("smoke/message-attachments-fixture.tsx"),
        output: {
          entryFileNames: "fixture.js",
          chunkFileNames: "[name]-[hash].js",
          assetFileNames: "[name].[ext]",
        },
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
    if (req.url === "/" || req.url === "/?child") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self' blob: https: ws: wss:; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'",
      );
      res.end(
        `<!doctype html><meta charset="utf-8">${css.map((file) => `<link rel="stylesheet" href="/${file}">`).join("")}<style>body{padding:32px}#root{max-width:800px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`,
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
  await page.addInitScript(() => {
    window.blobFetches = 0;
    window.originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).startsWith("blob:")) {
        window.blobFetches++;
        throw new TypeError("Stored attachments must reuse their original bytes");
      }
      return window.originalFetch(url, options);
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items) => {
          const blob = await items[0].getType("image/png");
          window.imageCopy = {
            type: blob.type,
            bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
          };
        },
      },
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Preview screen.png", exact: true })
    .waitFor();
  const child = page.frames().find((frame) => frame.url().endsWith("?child"));
  const preview = child.getByRole("button", { name: "Preview screen.png", exact: true });
  await preview.waitFor();
  await child.waitForFunction(
    () => document.querySelector('[data-slot="attachment-media"] img')?.naturalWidth > 0,
  );
  assert.equal(await child.getByRole("group", { name: "Attachments", exact: true }).count(), 1);
  assert.equal(await child.locator('[data-slot="attachment"]').count(), 5);
  assert.equal(await child.getByText("PNG · 2 KB", { exact: true }).count(), 1);
  const blobAllowed = await page.evaluate(async () => {
    const source = URL.createObjectURL(new Blob(["allowed"], { type: "text/plain" }));
    try {
      return await (await window.originalFetch(source)).text();
    } finally {
      URL.revokeObjectURL(source);
    }
  });
  assert.equal(blobAllowed, "allowed", "CSP explicitly permits app-created blob connections");
  const card = child.locator('[data-slot="attachment"]').first();
  const initialHeight = (await card.boundingBox()).height;
  await child.evaluate(() => {
    attachmentTest.writer = navigator.clipboard.write;
    navigator.clipboard.write = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await card.getByRole("button", { name: "Copy image", exact: true }).click();
  const errorButton = card.locator('button[data-feedback="error"]');
  await errorButton.waitFor();
  assert.equal(
    (await card.boundingBox()).height,
    initialHeight,
    "feedback does not resize the attachment",
  );
  assert.notEqual(
    await errorButton.evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  await child.evaluate(() => {
    navigator.clipboard.write = attachmentTest.writer;
  });
  await child.waitForFunction(() => !document.querySelector('button[data-feedback="error"]'));
  await preview.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByRole("dialog").getByRole("img", { name: "screen.png" }).count(), 1);
  assert.equal(
    await child.getByRole("dialog").count(),
    0,
    "the conversation never hosts its own modal",
  );
  const overlay = page.locator(".ui-dialog-overlay");
  const bounds = await overlay.boundingBox();
  assert.ok(
    bounds.x <= 0 && bounds.width >= 940 && bounds.height >= 640,
    `the backdrop covers the sidebar and entire app: ${JSON.stringify(bounds)}`,
  );
  const request = await page.evaluate(() => attachmentTest.requests[0]);
  assert.equal(request.channel, "ui.dialog.open");
  assert.equal(request.payload.kind, "image-preview");
  assert.ok(request.payload.url.startsWith("ovule-attachment:///"));
  await page.getByRole("dialog").getByRole("button", { name: "Copy image", exact: true }).click();
  await page.getByRole("dialog").getByText("Image copied", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => imageCopy.type), "image/png");
  assert.deepEqual(
    await page.evaluate(() => imageCopy.bytes.slice(0, 8)),
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  await page.getByRole("dialog").getByRole("button", { name: "Save image", exact: true }).click();
  await page.getByRole("dialog").getByText("Image saved", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => attachmentTest.saves[0].path), "screen.png");
  assert.ok((await page.evaluate(() => attachmentTest.saves[0].contents.length)) > 0);
  await page.screenshot({ path: "/private/tmp/ovule-app-attachment-preview.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await child.getByRole("button", { name: "Open report.pdf", exact: true }).click();
  await child.getByRole("button", { name: "Open archive.zip", exact: true }).click();
  assert.deepEqual(await child.evaluate(() => attachmentTest.events), [
    "office:/workspace/report.pdf",
    "browser:https://example.test/archive.zip",
  ]);
  assert.equal(await child.getByText("Image unavailable", { exact: true }).count(), 1);
  assert.equal(
    await child.getByRole("button", { name: "Open unsafe.txt", exact: true }).count(),
    0,
  );
  await child.getByRole("group", { name: "Attachments", exact: true }).evaluate((group) => {
    group.scrollLeft = 0;
  });
  await page.screenshot({ path: "/private/tmp/ovule-message-attachments.png" });
  await child.getByRole("button", { name: "Copy image", exact: true }).first().click();
  await child.getByText("Image copied", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "copying the card does not open the preview",
  );
  await child.getByRole("button", { name: "Copy message", exact: true }).click();
  await child.getByRole("button", { name: "Message copied", exact: true }).waitFor();
  await child.getByRole("button", { name: "Save message", exact: true }).click();
  await child.waitForFunction(() => attachmentTest.saves.length === 1);
  assert.equal(
    await child.evaluate(() =>
      new TextDecoder().decode(Uint8Array.from(attachmentTest.saves[0].contents)),
    ),
    "A message to copy and save",
  );
  await preview.click();
  await page.getByRole("dialog").getByRole("img", { name: "screen.png" }).waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] img')?.naturalWidth > 0);
  await child.evaluate(() => attachmentTest.unmount());
  assert.ok(
    (await page
      .getByRole("dialog")
      .getByRole("img")
      .evaluate((image) => image.naturalWidth)) > 0,
    "the top preview survives conversation unmount",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await child.evaluate(() => attachmentTest.revoked.length), 1);
  assert.equal(
    await page.evaluate(() => attachmentTest.revoked.length),
    3,
    "the top-level preview releases its independent image URL",
  );
  assert.equal(await page.evaluate(() => blobFetches), 0);
  assert.equal(await child.evaluate(() => blobFetches), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS message attachments: grouped cards, metadata, stored image preview, keyboard, file routing, missing/unsafe sources, blob cleanup",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(output, { recursive: true, force: true });
}
