import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { officeFixtures, pdfFixture } from "./office-fixtures.mjs";
import { main, availablePort, waitHttp, waitFor } from "./runner.mjs";

// A real business runtime and Explorer are required here: a browser facade
// cannot establish local MIME/download handling or child Shell API permissions.
await main("local-files-native", async (c) => {
  await c.claimPackage();
  const folder = join(c.root, "My Code 配置");
  await mkdir(join(folder, "nested"), { recursive: true });
  const first = pathToFileURL(join(folder, "config #prod.yaml")).href;
  const second = pathToFileURL(join(folder, "nested", "next.yml")).href;
  const text = "name: ovule\nenabled: true\nitems:\n  - local files\n";
  await writeFile(new URL(first), text);
  await writeFile(new URL(second), "version: 2\n");
  await writeFile(
    join(folder, "README.md"),
    "# Native Markdown\n\nThis is **rendered** text.\n\n- First item\n- Second item\n",
  );
  await writeFile(join(folder, "archive.zip"), Buffer.from("PK unsupported fixture"));
  await writeFile(join(folder, "large.yaml"), Buffer.alloc(2 * 1024 * 1024 + 1, "x"));
  for (const [extension, bytes] of Object.entries(await officeFixtures()))
    await writeFile(join(folder, `preview.${extension}`), bytes);
  if (process.platform === "darwin")
    execFileSync("/usr/bin/textutil", [
      "-convert",
      "doc",
      "-output",
      join(folder, "preview.doc"),
      join(folder, "preview.docx"),
    ]);
  await writeFile(join(folder, "preview.pdf"), pdfFixture());
  await writeFile(
    join(folder, "preview.html"),
    '<!doctype html><html><body><h1>Isolated HTML preview</h1><script>parent.document.documentElement.dataset.htmlExecuted="true"</script></body></html>',
  );
  await writeFile(join(c.root, "outside.html"), "<h1>Outside workspace</h1>");
  if (process.env.OVULE_LOCAL_XLSX_SAMPLE)
    await writeFile(
      join(folder, "sample.xlsx"),
      await readFile(process.env.OVULE_LOCAL_XLSX_SAMPLE),
    );
  const port = await availablePort(0);
  const app = c.launch(port, { extra: ["--no-first-run"] });
  await waitHttp(`http://127.0.0.1:${port}/json/version`, app, undefined, 120000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    let page;
    await waitFor(async () => {
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("ovule://-/main"));
      return Boolean(page);
    }, "packaged main window");
    await page.getByRole("heading", { name: "Configure your Agents" }).waitFor({ timeout: 60000 });
    await page.evaluate(() => {
      window.previewSource = (grant, file) => {
        const bounds = window.localFileNative?.element?.parentElement?.getBoundingClientRect() ?? {
          width: innerWidth - 80,
          height: innerHeight - 120,
        };
        const url = new URL(`ovule://${grant.id}.local/${grant.kind}`);
        url.searchParams.set("url", file);
        url.searchParams.set("width", bounds.width);
        url.searchParams.set("height", bounds.height);
        return url;
      };
      window.watchPreview = (element) => {
        window.localNativeViewportObserver?.disconnect();
        const sync = () => {
          const rect = element.getBoundingClientRect();
          element.postMessage({
            type: "preview.viewport",
            width: rect.width,
            height: rect.height,
          });
        };
        window.localNativeViewportObserver = new ResizeObserver(sync);
        window.localNativeViewportObserver.observe(element);
        element.addEventListener("loadstop", sync);
      };
    });
    const entries = await page.evaluate(
      async (url) => (await import("/shell_api.js")).browser.listLocalDirectory(url),
      pathToFileURL(`${folder}/`).href,
    );
    assert.equal(entries[0].isDirectory, true);
    assert.ok(entries.some((entry) => entry.url === first && entry.name === "config #prod.yaml"));
    assert.equal(
      await page.evaluate(
        async (url) => (await import("/shell_api.js")).browser.readLocalText(url),
        first,
      ),
      text,
    );
    await page.evaluate(async (file) => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:80px 40px 40px;z-index:200;background:white";
      const element = document.createElement("explorer");
      element.setAttribute("isolated", "");
      window.watchPreview(element);
      element.behavior = "navigation: delegate;";
      element.style.cssText = "display:block;width:100%;height:100%";
      const grant = await (await import("/shell_api.js")).browser.createFilePreview(file);
      const preview = window.previewSource(grant, file);
      preview.searchParams.set("url", file);
      window.localFileNative = { element, downloads: 0 };
      element.addEventListener("download", () => window.localFileNative.downloads++);
      element.src = preview.href;
      host.append(element);
      document.body.append(host);
    }, first);
    const content = () =>
      page.evaluate(() =>
        Promise.race([
          window.localFileNative.element.executeJavaScript(
            'document.querySelector("[data-preview-code-url] pre")?.textContent ?? document.querySelector("[role=alert]")?.textContent',
          ),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Document probe timed out")), 3000),
          ),
        ]),
      );
    await waitFor(
      async () => (await content()) === text,
      "native YAML preview and original newlines",
      60000,
    );
    await waitFor(
      async () =>
        await page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            'document.querySelectorAll("pre span[style]").length',
          ),
        ),
      "native syntax highlighting",
    );
    await page.evaluate(() =>
      window.localFileNative.element.executeJavaScript(`(async () => {
      const api = await import('/shell_api.js');
      const denied = async (call) => { try { await call(); return false; } catch { return true; } };
      const result = {
        origin: location.origin,
        appServices: Boolean(document.querySelector('[data-conversation-root]')),
        rawRead: await denied(() => api.browser.readLocalText('file:///tmp/private.yaml')),
        mint: await denied(() => api.browser.createFilePreview('file:///tmp/private.yaml')),
        htmlMint: await denied(() => api.browser.createHtmlPreview('thread', 'private.html')),
        list: await denied(() => api.browser.listLocalDirectory('file:///tmp/')),
        workspace: await denied(() => api.workspace.snapshot()),
        pathAsGrant: await denied(() => api.preview.readText(new URL(location.href).searchParams.get('url'))),
        unknownGrant: await denied(() => api.preview.describe('f'.repeat(48))),
      };
      document.documentElement.dataset.isolationResult = JSON.stringify(result);
    })()`),
    );
    let isolation;
    await waitFor(async () => {
      const result = await page.evaluate(() =>
        window.localFileNative.element.executeJavaScript(
          "document.documentElement.dataset.isolationResult",
        ),
      );
      if (!result) return false;
      isolation = JSON.parse(result);
      return true;
    }, "local renderer permission probes");
    assert.match(isolation.origin, /^ovule:\/\/[a-f0-9]{48}\.local$/);
    for (const key of [
      "rawRead",
      "mint",
      "htmlMint",
      "list",
      "workspace",
      "pathAsGrant",
      "unknownGrant",
    ])
      assert.equal(isolation[key], true, `${key} must be denied in the local renderer`);
    assert.equal(isolation.appServices, false);
    assert.equal(await page.evaluate(() => window.localFileNative.downloads), 0);
    assert.equal(
      await page.evaluate(async () => (await window.localFileNative.element.getDownloads()).length),
      0,
    );
    await page.evaluate(async (file) => {
      const grant = await (await import("/shell_api.js")).browser.createFilePreview(file);
      const url = window.previewSource(grant, file);
      url.searchParams.set("url", file);
      window.localFileNative.element.load(url.href);
    }, second);
    await waitFor(async () => (await content()) === "version: 2\n", "second native file");
    assert.equal(
      (await page.evaluate(() => window.localFileNative.element.getNavigationState())).canGoBack,
      true,
    );
    await page.evaluate(() => window.localFileNative.element.back());
    await waitFor(
      async () => (await content()) === text,
      "Chromium back restores first granted file",
    );
    assert.equal(
      (await page.evaluate(() => window.localFileNative.element.getNavigationState())).canGoForward,
      true,
    );
    await page.evaluate(() => window.localFileNative.element.forward());
    await waitFor(
      async () => (await content()) === "version: 2\n",
      "Chromium forward restores second granted file",
    );
    assert.equal(await page.evaluate(() => window.localFileNative.downloads), 0);
    await page.screenshot({ path: join(c.artifacts, "native-yaml-preview.png") });
    if (process.platform !== "darwin")
      console.log("SKIP legacy DOC conversion: macOS converter unavailable");
    for (const extension of [
      ...(process.platform === "darwin" ? ["doc"] : []),
      "docx",
      "xlsx",
      "pptx",
    ]) {
      const file = pathToFileURL(join(folder, `preview.${extension}`)).href;
      const metadata = await page.evaluate(async (url) => {
        const file = await (await import("/shell_api.js")).browser.readLocalFile(url);
        return {
          extension: file.extension,
          name: file.name,
          bytes: file.bytes.length,
          zip: file.bytes[0] === 80 && file.bytes[1] === 75,
        };
      }, file);
      assert.equal(metadata.extension, extension === "doc" ? "docx" : extension);
      assert.equal(metadata.name, `preview.${extension}`);
      assert.ok(metadata.bytes > 100 && metadata.zip);
      await page.evaluate(async (file) => {
        const grant = await (await import("/shell_api.js")).browser.createFilePreview(file);
        const url = window.previewSource(grant, file);
        url.searchParams.set("url", file);
        const previous = window.localFileNative.element;
        const element = document.createElement("explorer");
        element.setAttribute("isolated", "");
        window.watchPreview(element);
        element.behavior = "navigation: browser;";
        element.style.cssText = previous.style.cssText;
        element.addEventListener("download", () => window.localFileNative.downloads++);
        element.src = url.href;
        previous.replaceWith(element);
        window.localFileNative.element = element;
      }, file);
      await waitFor(
        async () =>
          await page.evaluate(() =>
            window.localFileNative.element.executeJavaScript(
              'document.querySelector("[data-preview-office-url]")?.dataset.ready === "true"',
            ),
          ),
        `native ${extension} preview`,
        60000,
      );
      assert.equal(
        await page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            'document.querySelector("[role=alert]")?.textContent ?? ""',
          ),
        ),
        "",
      );
      if (extension === "docx") {
        const guest = browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => /^ovule:\/\/[a-f0-9]{48}\.local\/office/.test(page.url()));
        assert.ok(
          guest,
          `Office CDP target: ${browser
            .contexts()
            .flatMap((context) => context.pages())
            .map((page) => page.url())
            .join(", ")}`,
        );
        const client = await guest.context().newCDPSession(guest);
        const { root } = await client.send("DOM.getDocument", { depth: -1, pierce: true });
        const closedRoot = (node) =>
          node.shadowRootType === "closed"
            ? node
            : [...(node.children ?? []), ...(node.shadowRoots ?? [])].map(closedRoot).find(Boolean);
        const shadow = closedRoot(root);
        assert.ok(shadow, "Office retains a closed extension Shadow DOM");
        const { object } = await client.send("DOM.resolveNode", {
          backendNodeId: shadow.backendNodeId,
        });
        const office = async (source, mode) => {
          const result = await client.send("Runtime.callFunctionOn", {
            objectId: object.objectId,
            functionDeclaration: `function(mode) {${source}}`,
            arguments: mode === undefined ? [] : [{ value: mode }],
            returnByValue: true,
          });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
          return result.result.value;
        };
        for (const mode of ["height", "spread", "width"]) {
          await office(
            `const select=this.querySelector('[aria-label="Page display mode"]'); select.value=mode; select.dispatchEvent(new Event('change', {bubbles:true}));`,
            mode,
          );
          await waitFor(
            () =>
              office(
                `const pages=[...this.querySelectorAll('.office-word-page')]; if(pages.length!==3) return false;
            if(mode==='spread') return Math.abs(pages[0].getBoundingClientRect().top-pages[1].getBoundingClientRect().top)<2;
            if(mode==='height') return pages[0].getBoundingClientRect().height<=this.querySelector('.office-root').clientHeight-this.querySelector('nav').offsetHeight-28;
            return pages[0].getBoundingClientRect().width<=this.querySelector('.office-root').clientWidth-30;`,
                mode,
              ),
            `native Word ${mode} display`,
          );
        }
        await waitFor(
          () =>
            office(`return Boolean(this.querySelector('.office-thumbnail-frame section.docx'));`),
          "native Word thumbnails",
        );
        await office(`this.querySelector('[aria-label="Page 3"]').click();`);
        await waitFor(
          () =>
            office(`return Number(this.querySelector('[aria-current="page"]').dataset.page)>1;`),
          "native Word thumbnail navigation",
        );
        await client.detach();
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
      await page.screenshot({ path: join(c.artifacts, `native-office-${extension}.png`) });
      if (extension !== "pptx") {
        await page.mouse.move(200, 400);
        await page.mouse.wheel(0, 500);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await page.screenshot({
          path: join(c.artifacts, `native-office-${extension}-scrolled.png`),
        });
      }
      assert.equal(await page.evaluate(() => window.localFileNative.downloads), 0);
    }
    for (const [name, route, heading] of [
      ["README.md", "/local-markdown", "Native Markdown"],
      ["archive.zip", "/local-unsupported", "Preview unavailable"],
      ["large.yaml", "/local-code", "File is too large to preview"],
    ]) {
      const file = pathToFileURL(join(folder, name)).href;
      await page.evaluate(
        async ({ file }) => {
          const grant = await (await import("/shell_api.js")).browser.createFilePreview(file);
          const url = window.previewSource(grant, file);
          url.searchParams.set("url", file);
          const previous = window.localFileNative.element;
          const element = document.createElement("explorer");
          element.setAttribute("isolated", "");
          window.watchPreview(element);
          element.behavior = "navigation: browser;";
          element.style.cssText = previous.style.cssText;
          element.src = url.href;
          element.addEventListener("download", () => window.localFileNative.downloads++);
          previous.replaceWith(element);
          window.localFileNative.element = element;
        },
        { file, route },
      );
      await waitFor(
        async () =>
          (await page.evaluate(() =>
            window.localFileNative.element.executeJavaScript(
              'document.querySelector("h1")?.textContent',
            ),
          )) === heading,
        `native ${name} preview`,
      );
      if (name === "README.md")
        assert.equal(
          await page.evaluate(() =>
            window.localFileNative.element.executeJavaScript(
              `document.querySelector('[data-streamdown="strong"]')?.textContent`,
            ),
          ),
          "rendered",
        );
      else {
        const centered = await page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            '(() => { const state = document.querySelector(".file-preview-state-content").getBoundingClientRect(); return Math.abs(state.top + state.height / 2 - innerHeight / 2) < 2; })()',
          ),
        );
        assert.equal(centered, true);
      }
      assert.equal(await page.evaluate(() => window.localFileNative.downloads), 0);
      await page.screenshot({ path: join(c.artifacts, `native-preview-${name}.png`) });
    }
    await page.evaluate(
      async (file) => {
        const grant = await (await import("/shell_api.js")).browser.createFilePreview(file);
        const previous = window.localFileNative.element;
        const element = document.createElement("explorer");
        element.setAttribute("isolated", "");
        window.watchPreview(element);
        element.behavior = "navigation: delegate;";
        element.style.cssText = previous.style.cssText;
        element.src = window.previewSource(grant, file).href;
        previous.replaceWith(element);
        window.localFileNative.element = element;
      },
      pathToFileURL(join(folder, "preview.pdf")).href,
    );
    await waitFor(
      async () =>
        await page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            'Boolean(document.querySelector(".preview-pdf-page[data-rendered]"))',
          ),
        ),
      "isolated PDF pixels",
      60000,
    );
    for (const width of [420, 800]) {
      await page.evaluate((width) => {
        window.localFileNative.element.parentElement.style.width = `${width}px`;
      }, width);
      await waitFor(
        async () =>
          await page.evaluate(() =>
            window.localFileNative.element.executeJavaScript(
              '(() => { const canvas = document.querySelector(".preview-pdf-page"); return Math.abs(canvas.getBoundingClientRect().width - (document.querySelector(".preview-pdf-pages").clientWidth - 32)) < 2 && canvas.width > 0; })()',
            ),
          ),
        "PDF fits resized pane",
      );
    }
    for (const mode of ["height", "spread", "width"]) {
      await page.evaluate(
        (mode) =>
          window.localFileNative.element.executeJavaScript(`(() => {
        const select = document.querySelector('[aria-label="Page display mode"]');
        select.value = ${JSON.stringify(mode)}; select.dispatchEvent(new Event('change', {bubbles:true}));
      })()`),
        mode,
      );
      await waitFor(
        async () =>
          page.evaluate(
            (mode) =>
              window.localFileNative.element.executeJavaScript(`(() => {
        const pages = [...document.querySelectorAll('.preview-pdf-page')];
        const host = document.querySelector('.preview-pdf-pages');
        if (pages.length !== 3) return false;
        if (${JSON.stringify(mode)} === 'spread') return Math.abs(pages[0].getBoundingClientRect().top - pages[1].getBoundingClientRect().top) < 2;
        return pages[0].getBoundingClientRect().height <= host.clientHeight - 30 || ${JSON.stringify(mode)} === 'width';
      })()`),
            mode,
          ),
        `native PDF ${mode} display`,
      );
    }
    await page.evaluate(() =>
      window.localFileNative.element.executeJavaScript(
        `document.querySelector('[aria-label="Page 2"]').click()`,
      ),
    );
    await waitFor(
      async () =>
        page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            `Number(document.querySelector('.preview-page-thumbnail[aria-current="page"]').dataset.page) > 1`,
          ),
        ),
      "native PDF thumbnail navigation",
    );
    await waitFor(
      async () =>
        page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            `Boolean(document.querySelector('.preview-page-thumbnail canvas[data-rendered="true"]'))`,
          ),
        ),
      "native PDF thumbnails",
    );
    await page.screenshot({ path: join(c.artifacts, "native-preview-pdf.png") });
    if (process.env.OVULE_LOCAL_XLSX_SAMPLE) {
      await page.evaluate(
        async (file) => {
          const grant = await (await import("/shell_api.js")).browser.createFilePreview(file);
          const previous = window.localFileNative.element;
          const element = document.createElement("explorer");
          element.setAttribute("isolated", "");
          window.watchPreview(element);
          element.style.cssText = previous.style.cssText;
          element.src = window.previewSource(grant, file).href;
          previous.replaceWith(element);
          window.localFileNative.element = element;
        },
        pathToFileURL(join(folder, "sample.xlsx")).href,
      );
      await waitFor(
        async () =>
          await page.evaluate(() =>
            window.localFileNative.element.executeJavaScript(
              'document.querySelector("[data-preview-office-url]")?.dataset.ready === "true"',
            ),
          ),
        "reported workbook transfer",
        60000,
      );
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(c.artifacts, "native-preview-reported-xlsx.png") });
    }
    const htmlGrant = await page.evaluate(async (folder) => {
      const api = await import("/shell_api.js");
      const before = new Set((await api.workspace.snapshot()).threads.map((thread) => thread.id));
      const snapshot = await api.workspace.createThread({ workspacePath: folder });
      const thread = snapshot.threads.find((thread) => !before.has(thread.id));
      if (!thread) throw new Error("HTML workspace Thread was not created");
      let escaped = false;
      try {
        await api.browser.createHtmlPreview(thread.id, "../outside.html");
        escaped = true;
      } catch {}
      if (escaped) throw new Error("HTML preview escaped the Thread workspace");
      const grant = await api.browser.createHtmlPreview(thread.id, "preview.html");
      const previous = window.localFileNative.element;
      const element = document.createElement("explorer");
      element.setAttribute("isolated", "");
      window.watchPreview(element);
      element.style.cssText = previous.style.cssText;
      const recipe = new URL("ovule://-/preview-html");
      recipe.searchParams.set("thread", thread.id);
      recipe.searchParams.set("path", "preview.html");
      const url = window.previewSource(grant, recipe.href);
      element.src = url.href;
      previous.replaceWith(element);
      window.localFileNative.element = element;
      return grant;
    }, folder);
    assert.equal(htmlGrant.kind, "html");
    await waitFor(
      async () =>
        await page.evaluate(() =>
          window.localFileNative.element.executeJavaScript(
            'Boolean(document.querySelector("iframe[data-preview-html-url]"))',
          ),
        ),
      "isolated HTML renderer",
      60000,
    );
    assert.equal(
      await page.evaluate(() =>
        window.localFileNative.element.executeJavaScript(
          '(() => { const frame = document.querySelector("iframe"); return frame.getAttribute("sandbox") === "" && frame.srcdoc.includes("Isolated HTML preview") && !frame.srcdoc.includes("<script") && document.documentElement.dataset.htmlExecuted !== "true"; })()',
        ),
      ),
      true,
    );
    await page.screenshot({ path: join(c.artifacts, "native-preview-html.png") });
    console.log(
      "local_files_native=ok native_history=ok word_pdf_modes_thumbnails=ok html_sandbox=ok pdf_resizing=ok yaml_preview=ok office_docx_xlsx_pptx=ok isolated_origin=ok scoped_permissions=ok markdown_archive_large=ok downloads=0 directory_encoding=ok file_open=ok",
    );
  } finally {
    await browser.close();
  }
});
