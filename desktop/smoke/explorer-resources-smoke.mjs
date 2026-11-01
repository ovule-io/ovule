import { clientDirectives } from "../scripts/client-directives-plugin.mjs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { officeFixtures } from "./office-fixtures.mjs";
import { build } from "vite";
import { chromium } from "playwright-core";
const output = await mkdtemp(path.join(os.tmpdir(), "explorer-resources-ui-"));
let pdfData = "%PDF-1.4\n";
const offsets = [0];
const stream = "0 0 0 rg 40 40 100 100 re f\n";
const objects = [
  "<</Type/Catalog/Pages 2 0 R>>",
  "<</Type/Pages/Count 3/Kids[3 0 R 3 0 R 3 0 R]>>",
  "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 400]/Contents 4 0 R>>",
  `<</Length ${stream.length}>>\nstream\n${stream}endstream`,
];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdfData));
  pdfData += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdfData);
pdfData += `xref\n0 5\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  .join("")}trailer\n<</Size 5/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
if (process.env.OVULE_UI_PDF_URL) {
  const response = await fetch(process.env.OVULE_UI_PDF_URL);
  assert.ok(response.ok, `PDF fixture HTTP ${response.status}`);
  pdfData = Buffer.from(await response.arrayBuffer());
  assert.ok(pdfData.length < 64 * 1024 * 1024);
}
await build({
  configFile: false,
  plugins: [clientDirectives()],
  build: {
    outDir: output,
    emptyOutDir: false,
    target: "esnext",
    rollupOptions: {
      external: ["/tuffite.js"],
      input: path.resolve("smoke/explorer-resources-fixture.ts"),
      output: { entryFileNames: "fixture.js", assetFileNames: "[name].[ext]" },
    },
  },
  logLevel: "warn",
});
await writeFile(path.join(output, "preview.pdf"), pdfData);
for (const [extension, data] of Object.entries(await officeFixtures()))
  await writeFile(path.join(output, `fixture.${extension}`), data);
await writeFile(
  path.join(output, "office-ui.js"),
  await readFile(new URL("../extensions/visuals/dist/ui.js", import.meta.url)),
);
if (process.env.OVULE_LOCAL_XLSX_SAMPLE)
  await writeFile(
    path.join(output, "fixture.sample.xlsx"),
    await readFile(process.env.OVULE_LOCAL_XLSX_SAMPLE),
  );
const stylesheet = (await readdir(output)).find((file) => file.endsWith(".css"));
await writeFile(
  path.join(output, "index.html"),
  `<!doctype html><meta charset="utf-8"><style>body{margin:0}#host{width:600px;height:500px;position:relative} :root{--surface:#fff;--foreground:#222;--line-strong:#ddd}</style><link rel="stylesheet" href="/${stylesheet}"><div id="host"></div><script type="module" src="/fixture.js"></script>`,
);
const server = http.createServer(async (request, response) => {
  try {
    const file = path.join(
      output,
      request.url === "/" ? "index.html" : new URL(request.url, "http://fixture").pathname,
    );
    response.setHeader(
      "content-type",
      file.endsWith(".css")
        ? "text/css"
        : /\.m?js$/.test(file)
          ? "application/javascript"
          : "text/html",
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let native;
let browser;
if (process.env.OVULE_FRAMEWORK_APP) {
  const app = process.env.OVULE_FRAMEWORK_APP;
  const port = Number(process.env.OVULE_CDP_PORT || 9437);
  native = spawn(
    app,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${output}/profile`, "--no-first-run"],
    { cwd: path.dirname(app), stdio: "ignore" },
  );
  const deadline = Date.now() + 30000;
  while (!browser && Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(browser, "Native fixture did not expose CDP");
} else {
  browser = await chromium.launch({
    executablePath:
      process.env.OVULE_BROWSER_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
}
try {
  const page = native
    ? browser.contexts()[0].pages()[0]
    : await browser.newPage({ viewport: { width: 700, height: 600 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.resourceUiTest);
  await page.evaluate(() => resourceUiTest.code());
  const codeFrame = page.frameLocator("#local-code-fixture iframe");
  await codeFrame.locator('pre[data-ovule-code="typescript"]').waitFor();
  assert.equal(
    await codeFrame.locator("pre").textContent(),
    'const message: string = "<script>literal</script>";\nconsole.log(message);\n',
  );
  assert.equal(await codeFrame.locator("script").count(), 0, "source is inert text");
  assert.ok((await codeFrame.locator("pre span").count()) > 3);
  const keyword = codeFrame.locator("pre span").first();
  await page.emulateMedia({ colorScheme: "light" });
  const lightColor = await keyword.evaluate((node) => getComputedStyle(node).color);
  await page.emulateMedia({ colorScheme: "dark" });
  assert.notEqual(await keyword.evaluate((node) => getComputedStyle(node).color), lightColor);
  await page.screenshot({ path: "/private/tmp/explorer-local-code-ui.png" });
  const crumbs = page.locator("#local-code-fixture");
  await crumbs.getByRole("button", { name: "example.ts", exact: true }).click();
  const picker = page.locator("[data-file-picker]");
  await picker.getByRole("button", { name: "nested", exact: true }).click();
  assert.equal(
    await crumbs.getAttribute("data-navigated"),
    null,
    "opening a folder only browses the dropdown",
  );
  await picker.getByRole("button", { name: "config.yaml", exact: true }).click();
  assert.equal(
    await crumbs.getAttribute("data-navigated"),
    "file:///tmp/My%20Code/src/nested/config.yaml",
  );
  assert.match(await crumbs.getAttribute("data-source"), /\/local-code\?/);
  await picker.waitFor({ state: "hidden" });
  await crumbs.getByRole("button", { name: "My Code", exact: true }).click();
  await picker.getByRole("textbox", { name: "Filter files" }).fill("settings");
  await picker.getByRole("button", { name: "settings.yaml", exact: true }).waitFor();
  assert.equal(await picker.getByRole("button", { name: "src", exact: true }).count(), 0);
  await picker.getByRole("textbox", { name: "Filter files" }).click();
  assert.equal(await picker.isVisible(), true, "inside clicks keep the file picker open");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "file-picker-outside";
    button.textContent = "Outside file picker";
    button.style.cssText = "position:fixed;right:4px;bottom:4px;z-index:1000";
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.body.append(button);
  });
  await page.locator("#file-picker-outside").click();
  await picker.waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#file-picker-outside").evaluate((node) => document.activeElement === node),
    true,
    "dismissal preserves the outside click focus",
  );
  await crumbs.getByRole("button", { name: "My Code", exact: true }).click();
  await picker.waitFor();
  await codeFrame.locator("body").click({ position: { x: 600, y: 180 } });
  await picker.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("#local-code-fixture iframe")
      .evaluate((node) => document.activeElement === node),
    true,
    "guest focus stays in the content area",
  );
  await page.locator("#file-picker-outside").evaluate((node) => node.remove());
  await crumbs.getByRole("button", { name: "My Code", exact: true }).click();
  await picker.waitFor();
  await page.keyboard.press("Escape");
  await picker.waitFor({ state: "hidden" });
  // Resize the actual breadcrumb container and verify gradual collapse and restore.
  const width = await crumbs
    .locator(".cm-file-breadcrumb-measure")
    .evaluate((node) => node.getBoundingClientRect().width);
  await crumbs.evaluate((node, width) => {
    node.style.width = `${width + 160}px`;
  }, width);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Show hidden folders"]'));
  await crumbs.evaluate((node) => {
    node.style.width = "260px";
  });
  await crumbs.getByRole("button", { name: "Show hidden folders" }).waitFor();
  const firstHidden =
    (await crumbs.locator(".cm-file-breadcrumb-measure li").count()) -
    (await crumbs.locator(".cm-file-breadcrumb .cm-file-crumb").count()) +
    1;
  await crumbs.evaluate((node) => {
    node.style.width = "180px";
  });
  await page.waitForTimeout(100);
  const secondHidden =
    (await crumbs.locator(".cm-file-breadcrumb-measure li").count()) -
    (await crumbs.locator(".cm-file-breadcrumb .cm-file-crumb").count()) +
    1;
  assert.ok(secondHidden >= firstHidden);
  assert.equal(await crumbs.getByRole("button", { name: "config.yaml", exact: true }).count(), 1);
  assert.ok(
    await crumbs
      .locator(".cm-file-breadcrumb-container")
      .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    "breadcrumbs do not overflow",
  );
  await crumbs.getByRole("button", { name: "Show hidden folders" }).click();
  await page
    .locator(".cm-file-picker-hidden")
    .getByRole("button", { name: "My Code", exact: true })
    .click();
  await picker.getByRole("button", { name: "settings.yaml", exact: true }).click();
  assert.equal(await crumbs.getAttribute("data-navigated"), "file:///tmp/My%20Code/settings.yaml");
  await page.screenshot({ path: "/private/tmp/explorer-breadcrumb-overflow-ui.png" });
  await page.evaluate(() => document.querySelector("#local-code-fixture").dispose());
  await page.evaluate(() => resourceUiTest.yaml());
  const yaml = page.locator('[data-preview-code-url="file:///tmp/My%20Code/settings.yaml"]');
  await yaml.locator("pre").waitFor();
  assert.equal(
    await yaml.locator("pre").textContent(),
    "name: ovule\nenabled: true\nitems:\n  - local files\n" +
      Array.from(
        { length: 150 },
        (_, index) => `item_${index}: ${"long content ".repeat(20)}\n`,
      ).join(""),
  );
  await page.waitForFunction(() => document.querySelector("#yaml-preview-fixture pre span[style]"));
  assert.equal(
    await page.locator("[data-download-history]").count(),
    0,
    "YAML preview creates no downloads",
  );
  await yaml.hover();
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.querySelector(".preview-code").scrollTop > 0);
  assert.ok(await yaml.evaluate((node) => node.scrollHeight > node.clientHeight));
  await yaml.evaluate((node) => {
    node.scrollLeft = 200;
  });
  assert.ok(
    await yaml.evaluate((node) => node.scrollLeft > 0),
    "long code lines scroll horizontally",
  );
  await page.screenshot({ path: "/private/tmp/explorer-yaml-preview-ui.png" });
  await page.evaluate(() => document.querySelector("#yaml-preview-fixture").dispose());
  for (const extension of ["xlsx", "docx", "pptx"]) {
    await page.evaluate((extension) => resourceUiTest.office(extension), extension);
    const preview = page.locator("#office-preview-fixture");
    if (extension === "xlsx") {
      await preview.locator(".office-grid input").first().waitFor();
      assert.equal(
        await preview.locator(".office-grid input").first().inputValue(),
        "Local spreadsheet",
      );
      assert.equal(
        await preview.locator(".office-grid input").first().getAttribute("readonly"),
        "",
      );
      const scroll = preview.locator(".office-grid-wrap");
      await scroll.hover();
      await page.mouse.wheel(0, 500);
      await page.waitForFunction(
        () =>
          document
            .querySelector(".preview-office-host")
            .shadowRoot.querySelector(".office-grid-wrap").scrollTop > 0,
      );
    } else if (extension === "docx") {
      await preview
        .locator(".office-word")
        .getByText("Local Word paragraph 0", { exact: true })
        .waitFor();
      const scroll = preview.locator(".office-word");
      await scroll.hover();
      await page.mouse.wheel(0, 500);
      await page.waitForFunction(
        () =>
          document.querySelector(".preview-office-host").shadowRoot.querySelector(".office-word")
            .scrollTop > 0,
      );
    } else {
      await preview.getByText("1 / 1", { exact: true }).waitFor();
      assert.ok(
        await preview.locator("canvas").evaluate((canvas) => canvas.width > 0 && canvas.height > 0),
      );
    }
    for (const width of [420, 1000, 700]) {
      await page.setViewportSize({ width, height: 600 });
      await page.waitForTimeout(150);
      const layout = await preview.evaluate((node) => {
        const host = node.querySelector(".preview-office-host");
        const root = host.shadowRoot;
        const page = root.querySelector(".office-word-page section.docx");
        const canvas = root.querySelector("canvas");
        const grid = root.querySelector(".office-grid-wrap");
        return {
          host: host.clientWidth,
          page: page?.getBoundingClientRect().width,
          canvas: canvas?.getBoundingClientRect().width,
          grid: grid?.clientWidth,
          overflow: root.querySelector(".office-root").scrollWidth > host.clientWidth + 1,
        };
      });
      assert.equal(layout.overflow, false, `${extension} stays inside a ${width}px pane`);
      if (extension === "docx") assert.ok(layout.page <= layout.host - 16, "Word fits page width");
      if (extension === "xlsx")
        assert.ok(layout.grid <= layout.host, "sheet owns horizontal overflow");
      if (extension === "pptx")
        assert.ok(layout.canvas > Math.min(layout.host - 80, 500), "slide grows with pane");
    }
    if (extension === "docx") {
      await preview.getByLabel("Page display mode").selectOption("height");
      await page.waitForTimeout(100);
      const fit = await preview
        .locator(".office-word-page section.docx")
        .first()
        .evaluate((node) => ({
          height: node.getBoundingClientRect().height,
          offset: node.offsetHeight,
          zoom: node.style.zoom,
          root: node.closest(".office-root").clientHeight,
          toolbar: node.closest(".office-root").querySelector("nav").offsetHeight,
        }));
      assert.ok(fit.height <= fit.root - fit.toolbar - 28, JSON.stringify(fit));
      await preview.getByLabel("Page display mode").selectOption("spread");
      assert.equal(await preview.locator(".office-word-page section.docx").count(), 3);
      await preview.getByRole("button", { name: "Page 3", exact: true }).click();
      assert.equal(
        await preview
          .getByRole("button", { name: "Page 3", exact: true })
          .getAttribute("aria-current"),
        "page",
      );
      await preview.getByRole("button", { name: "Page 1", exact: true }).click();
      await preview.getByLabel("Hide page thumbnails").click();
      assert.equal(await preview.locator(".office-page-thumbnails").isVisible(), false);
      await preview.getByLabel("Show page thumbnails").click();
      assert.equal(await preview.locator(".office-page-thumbnails").isVisible(), true);
      await preview.getByLabel("Page display mode").selectOption("width");
    }
    assert.equal(await preview.locator(".office-error").count(), 0);
    await page.screenshot({ path: `/private/tmp/explorer-office-${extension}.png` });
    await page.evaluate(() => document.querySelector("#office-preview-fixture").dispose());
  }
  if (process.env.OVULE_LOCAL_XLSX_SAMPLE) {
    await page.evaluate(() => resourceUiTest.office("sample"));
    const preview = page.locator("#office-preview-fixture");
    await preview.locator(".office-grid input, [role=alert]").first().waitFor();
    assert.equal(
      await preview.locator("[role=alert]").count(),
      0,
      await preview.locator("[role=alert]").allTextContents(),
    );
    assert.equal(await preview.locator(".office-error").count(), 0);
    assert.ok((await preview.locator(".office-grid input").count()) > 0);
    await page.screenshot({ path: "/private/tmp/explorer-office-reported-xlsx.png" });
    await page.evaluate(() => document.querySelector("#office-preview-fixture").dispose());
  }
  await page.evaluate(() => resourceUiTest.previewState("pdf"));
  for (const width of [420, 900, 460, 1000, 700])
    await page.setViewportSize({ width, height: 600 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector(".preview-pdf-page");
    return (
      canvas?.dataset.rendered === "true" &&
      Math.abs(
        canvas.getBoundingClientRect().width -
          (document.querySelector(".preview-pdf-pages").clientWidth - 32),
      ) < 2
    );
  });
  if (!process.env.OVULE_UI_PDF_URL) {
    assert.deepEqual(
      await page
        .locator(".preview-pdf-page")
        .first()
        .evaluate((canvas) =>
          Array.from(
            canvas
              .getContext("2d")
              .getImageData(Math.floor(canvas.width * 0.2), Math.floor(canvas.height * 0.75), 1, 1)
              .data,
          ),
        ),
      [0, 0, 0, 255],
      "resized PDF retains rendered pixels",
    );
  }
  await page.getByLabel("Page display mode").selectOption("height");
  await page.waitForFunction(
    () => document.querySelector(".preview-pdf-page").getBoundingClientRect().height <= 530,
  );
  await page.getByLabel("Page display mode").selectOption("spread");
  await page.waitForFunction(() => {
    const pages = document.querySelectorAll(".preview-pdf-page");
    return (
      Math.abs(pages[0].getBoundingClientRect().top - pages[1].getBoundingClientRect().top) < 2
    );
  });
  await page.getByRole("button", { name: "Page 3", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".preview-pdf-pages").scrollTop > 0);
  await page.getByRole("button", { name: "Page 1", exact: true }).click();
  await page.getByLabel("Hide page thumbnails").click();
  assert.equal(await page.locator(".preview-page-thumbnails").isVisible(), false);
  await page.getByLabel("Show page thumbnails").click();
  await page.waitForFunction(() =>
    document.querySelector('.preview-page-thumbnail canvas[data-rendered="true"]'),
  );
  await page.screenshot({ path: "/private/tmp/explorer-pdf-thumbnails.png" });
  await page.evaluate(() => document.querySelector("#file-state-fixture").dispose());
  for (const kind of ["html", "html-script"]) {
    await page.evaluate((kind) => resourceUiTest.previewState(kind), kind);
    const preview = page.locator("#file-state-fixture");
    if (kind === "html") {
      const frame = preview.locator("iframe[title='Local HTML preview']");
      assert.equal(await frame.getAttribute("sandbox"), "");
      await frame.contentFrame().getByRole("heading", { name: "Safe local preview" }).waitFor();
      assert.equal(await frame.contentFrame().locator("script").count(), 0);
      assert.equal(await frame.contentFrame().locator("[onerror]").count(), 0);
      assert.equal(
        await frame
          .contentFrame()
          .locator("h1")
          .evaluate((node) => getComputedStyle(node).color),
        "rgb(1, 2, 3)",
      );
      assert.equal(await page.evaluate(() => Boolean(window.htmlExecuted)), false);
    } else await preview.getByText("Interactive scripts were removed", { exact: true }).waitFor();
    await page.evaluate(() => document.querySelector("#file-state-fixture").dispose());
  }
  for (const kind of ["markdown", "unsupported", "large"]) {
    await page.evaluate((kind) => resourceUiTest.previewState(kind), kind);
    const preview = page.locator("#file-state-fixture");
    if (kind === "markdown") {
      await preview.getByRole("heading", { name: "Project notes" }).waitFor();
      assert.equal(await preview.locator('[data-streamdown="strong"]').textContent(), "rendered");
      assert.equal(await preview.locator("li").count(), 2);
      const link = new URL(
        await preview.getByRole("link", { name: "Other file" }).getAttribute("href"),
      );
      assert.equal(link.pathname, "/local-markdown");
      assert.equal(link.searchParams.get("url"), "file:///tmp/project/other.md");
      await preview.locator(".preview-markdown").hover();
      await page.mouse.wheel(0, 500);
      await page.waitForFunction(() => document.querySelector(".preview-markdown").scrollTop > 0);
    } else {
      await preview
        .getByRole("heading", {
          name: kind === "large" ? "File is too large to preview" : "Preview unavailable",
        })
        .waitFor();
      const bounds = await preview.evaluate((node) => {
        const viewport = node.getBoundingClientRect();
        const state = node.querySelector(".file-preview-state-content").getBoundingClientRect();
        return {
          x: Math.abs(state.left + state.width / 2 - (viewport.left + viewport.width / 2)),
          y: Math.abs(state.top + state.height / 2 - (viewport.top + viewport.height / 2)),
        };
      });
      assert.ok(bounds.x < 2 && bounds.y < 2, `file state is centered: ${JSON.stringify(bounds)}`);
      assert.ok(!(await preview.textContent()).includes("TuffiteError"));
      assert.ok((await preview.textContent()).includes(kind === "large" ? "2 MiB" : "archive.zip"));
    }
    await page.screenshot({ path: `/private/tmp/explorer-file-${kind}.png` });
    await page.evaluate(() => document.querySelector("#file-state-fixture").dispose());
  }
  const loading = page.locator(".explorer-loading-indicator");
  const feedback = page.locator(".ovule-control-feedback");
  await page.evaluate(() => resourceUiTest.loading("loadstart"));
  await loading.waitFor({ state: "visible" });
  assert.equal(await loading.evaluate((node) => getComputedStyle(node).height), "2px");
  assert.equal(await loading.evaluate((node) => getComputedStyle(node).pointerEvents), "none");
  assert.equal(
    await feedback.getAttribute("data-active"),
    null,
    "ordinary loading has no control glow",
  );
  await page.evaluate(() => resourceUiTest.navigate("https://fixture/ordinary"));
  assert.equal(
    await feedback.getAttribute("data-active"),
    null,
    "ordinary commits never pulse Browser Use feedback",
  );
  assert.equal(await loading.isVisible(), true, "commit does not prematurely finish loading");
  await page.evaluate(() => resourceUiTest.loading("loadstop"));
  await loading.waitFor({ state: "hidden" });
  await page.evaluate(() => resourceUiTest.control());
  assert.equal(
    await feedback.getAttribute("data-active"),
    "true",
    "Browser Use actions retain control feedback",
  );
  assert.equal(
    await loading.isVisible(),
    false,
    "control activity does not pretend to load a page",
  );
  await page.evaluate(() => resourceUiTest.loading("loadstart"));
  await page.evaluate(() => resourceUiTest.loading("loaderror"));
  await loading.waitFor({ state: "hidden" });
  assert.equal(
    await feedback.getAttribute("data-active"),
    null,
    "failure clears active control feedback",
  );
  const item = {
    id: 1,
    url: "https://fixture/image.png",
    filename: "image.png",
    path: "/Downloads/image.png",
    mimeType: "image/png",
    navigation: false,
    state: "in-progress",
    receivedBytes: 50,
    totalBytes: 100,
    error: 0,
  };
  assert.equal(await page.locator("[data-download-history]").count(), 0);
  await page.evaluate((item) => resourceUiTest.update(item), item);
  await page.locator("[data-download-history]").click();
  assert.match(await page.locator("[data-download-history]").getAttribute("aria-label"), /50%/);
  assert.equal(await page.locator("progress").getAttribute("value"), "0.5");
  const panel = page.locator('[data-slot="popover-content"]');
  const triggerBox = await page.locator("[data-download-history]").boundingBox();
  const panelBox = await panel.boundingBox();
  assert.ok(Math.abs(panelBox.y - triggerBox.y) < 3, "Overlay panel aligns to button top");
  assert.ok(panelBox.x + panelBox.width <= triggerBox.x - 10, "Panel has a clear left-side gap");
  assert.equal(
    await panel.locator("header").getByText("/Users/test/Downloads", { exact: true }).count(),
    0,
  );
  assert.equal(
    await panel.locator("header").evaluate((header) => getComputedStyle(header).paddingBottom),
    "8px",
  );
  assert.equal(await panel.locator("[data-download-size]").textContent(), "50 B / 100 B");
  assert.ok(await panel.locator("time").getAttribute("datetime"));
  assert.equal(await panel.locator("footer").count(), 0);
  assert.equal(await page.locator('[data-download-record][data-slot="attachment"]').count(), 1);
  assert.equal(
    await page.locator('[data-download-record] [data-slot="attachment-title"]').textContent(),
    "image.png",
  );
  await page.locator("[data-download-record]").hover();
  assert.equal(
    await page
      .locator("[data-download-record]")
      .evaluate((row) => getComputedStyle(row).borderRadius),
    "8px",
  );
  await page.screenshot({ path: "/private/tmp/ovule-download-panel-hover.png" });
  await panel.locator("header").click();
  assert.equal(await panel.isVisible(), true, "inside clicks keep download history open");
  await page.evaluate(() => {
    const outside = document.createElement("button");
    outside.id = "outside-download-history";
    outside.textContent = "Outside downloads";
    outside.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:999";
    outside.addEventListener("pointerdown", (event) => event.stopPropagation());
    outside.addEventListener("click", () => (outside.dataset.clicked = "true"));
    document.body.append(outside);
  });
  await page.locator("#outside-download-history").click();
  await panel.waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#outside-download-history").getAttribute("data-clicked"),
    "true",
    "dismissal preserves the outside click",
  );
  assert.equal(
    await page
      .locator("#outside-download-history")
      .evaluate((button) => document.activeElement === button),
    true,
    "dismissal does not steal focus back",
  );
  await page.locator("[data-download-history]").click();
  await panel.waitFor();
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "download-outside-frame";
    frame.style.cssText =
      "position:fixed;left:12px;bottom:60px;width:140px;height:60px;z-index:999";
    frame.srcdoc = "<button>Guest page</button>";
    document.body.append(frame);
  });
  await page.frameLocator("#download-outside-frame").getByRole("button").click();
  await panel.waitFor({ state: "hidden" });
  await page.evaluate(() => document.querySelector("#download-outside-frame").remove());
  await page.locator("[data-download-history]").click();
  await panel.waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.hasAttribute("data-download-history"));
  await page.locator("[data-download-history]").click();
  await panel.waitFor();
  await page.getByRole("button", { name: "Pause download", exact: true }).click();
  await page.getByText("Paused", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume download", exact: true }).click();
  await page.getByRole("button", { name: "Pause download", exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => resourceUiTest.cancelled()), 1);
  await page.locator("[data-download-record]").hover();
  await page.getByRole("button", { name: "Delete file and record", exact: true }).click();
  await page.locator("[data-download-history]").waitFor({ state: "detached" });
  await page.evaluate((item) => resourceUiTest.update(item), {
    ...item,
    id: 2,
    path: "/Downloads/unknown/image.png",
    totalBytes: -1,
  });
  await page.locator("[data-download-history]").click();
  assert.equal(await page.locator("progress").getAttribute("value"), null);
  await page.locator("[data-download-record]").hover();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Delete file and record", exact: true }).click();
  await page.evaluate((data) => resourceUiTest.data(data), Buffer.from(pdfData).toString("base64"));
  const pdf = {
    ...item,
    id: 3,
    path: "/Downloads/pdf/document.pdf",
    url: "https://fixture/document.pdf",
    filename: "document.pdf",
    mimeType: "application/pdf",
    navigation: true,
    state: "complete",
  };
  await page.evaluate((item) => resourceUiTest.update(item), pdf);
  await page.waitForFunction(() => document.querySelector(".explorer-pdf canvas[data-rendered]"));
  if (!process.env.OVULE_UI_PDF_URL)
    assert.ok(
      await page.evaluate(() => {
        const canvas = document.querySelector(".explorer-pdf canvas");
        return (
          canvas.height >= 400 &&
          canvas.getContext("2d").getImageData(canvas.width / 3, canvas.height * 0.8, 1, 1)
            .data[0] === 0
        );
      }),
      "PDF must paint actual page content",
    );
  await page.locator("[data-download-history]").click();
  await page.locator("[data-download-record]").hover();
  await page.getByRole("button", { name: "Open in folder", exact: true }).click();
  assert.equal(await page.evaluate(() => resourceUiTest.revealed()), "saved-3");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "/private/tmp/explorer-pdf-ui.png" });
  await page.evaluate(() => resourceUiTest.transfer());
  await page.waitForFunction(() => document.querySelector(".explorer-pdf canvas[data-rendered]"));
  await page.evaluate(() => resourceUiTest.navigate("https://fixture/another-page"));
  assert.equal(await page.locator(".explorer-pdf").count(), 0);
  await page.evaluate(() => resourceUiTest.dispose());
  assert.equal(await page.locator(".explorer-resource-ui").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Explorer resource UI smoke passed: overlay alignment, compact header, file size/time, Attachment cards/actions, progress/cancel, unknown length, PDF pixels, transfer replay, navigation and disposal",
  );
} finally {
  await browser.close();
  native?.kill();
  await new Promise((resolve) => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
