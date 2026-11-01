import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const requireOffice = createRequire(new URL("../extensions/visuals/package.json", import.meta.url));
const ExcelJS = requireOffice("exceljs");
const source = new ExcelJS.Workbook();
source.addWorksheet("License review").addRow(["开源许可", 42]);
const xlsx = Buffer.from(await source.xlsx.writeBuffer());
const files = new Map([
  ["/", { type: "text/html", bytes: Buffer.from("<!doctype html><html><body></body></html>") }],
  ["/fixture.xlsx", { type: "application/octet-stream", bytes: xlsx }],
]);
for (const name of ["ui.js"]) {
  files.set(`/${name}`, {
    type: "text/javascript",
    bytes: await readFile(new URL(`../extensions/visuals/dist/${name}`, import.meta.url)),
  });
}
const server = http.createServer((request, response) => {
  const file = files.get(request.url);
  if (!file) return response.writeHead(404).end();
  response.writeHead(200, { "Content-Type": file.type });
  response.end(file.bytes);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.OVULE_BROWSER, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    globalThis.tuffite = {
      isolated: {
        customElements,
        context() {
          return { request: async () => null };
        },
      },
    };
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/ui.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    const editor = document.createElement("ovule-office-editor");
    editor.id = "editor";
    editor.file = {
      name: "fixture.xlsx",
      extension: "xlsx",
      readOnly: false,
      bytes: new Uint8Array(await (await fetch("/fixture.xlsx")).arrayBuffer()),
    };
    document.body.append(editor);
  });
  await page.waitForFunction(() => document.querySelector("#editor input, #editor .office-error"));
  assert.equal(
    await page.locator(".office-error").count(),
    0,
    await page.locator("body").innerText(),
  );
  assert.equal(await page.locator("input").first().inputValue(), "开源许可");
  await page.locator("input").first().fill("MIT OR Apache-2.0");
  const bytes = await page.evaluate(async () =>
    Array.from(await document.querySelector("#editor").exportFile()),
  );
  const decoded = new ExcelJS.Workbook();
  await decoded.xlsx.load(Buffer.from(bytes));
  assert.equal(decoded.worksheets[0].getCell("A1").value, "MIT OR Apache-2.0");
  assert.equal(decoded.worksheets[0].getCell("B1").value, 42);
  await page.evaluate(() => {
    const editor = document.querySelector("#editor");
    editor.file = {
      name: "fixture.csv",
      extension: "csv",
      readOnly: false,
      bytes: new TextEncoder().encode('name,value\n"开源,许可",42\n'),
    };
  });
  await page.waitForFunction(() => document.querySelector("#editor input")?.value === "name");
  const csv = await page.evaluate(async () =>
    new TextDecoder().decode(await document.querySelector("#editor").exportFile()),
  );
  assert.ok(csv.includes('"开源,许可",42'), csv);
  assert.deepEqual(errors, []);
  console.log("office_bundle=ok xlsx_load_edit_export=pass csv_export=pass");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
