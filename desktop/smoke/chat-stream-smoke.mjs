import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
const output = await mkdtemp(path.join(tmpdir(), "ovule-chat-stream-"));
let server, browser;
try {
  await build({
    configFile: false,
    resolve: { alias: { "@ovule/shell-api": path.resolve("smoke/chat-stream-shell-api.ts") } },
    plugins: [tailwindcss()],
    build: {
      outDir: output,
      target: "esnext",
      rollupOptions: {
        input: path.resolve("smoke/chat-stream-fixture.tsx"),
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
    if (req.url === "/") {
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
  const tool = page.locator('[data-slot="tool"]');
  await tool.waitFor({ timeout: 10000 }).catch(async (error) => {
    console.error(await page.locator("body").innerText());
    throw error;
  });
  const toolGroup = page.locator("[data-tool-group]");
  const groupTrigger = toolGroup.locator(
    ':scope > [data-slot="trace-collapsible"] > [data-slot="trace-collapsible-trigger"]',
  );
  assert.equal(
    await groupTrigger.getAttribute("aria-expanded"),
    "true",
    "live tool group starts expanded",
  );
  await groupTrigger.click();
  await page.evaluate(() => chatTest.approval("request"));
  await page
    .locator('[data-message-id="reply"] [data-agent-approval]')
    .waitFor({ state: "visible" });
  assert.equal(
    await groupTrigger.getAttribute("aria-expanded"),
    "false",
    "pending permission stays outside collapsed tool history",
  );
  assert.equal(await page.locator("[data-agent-approval]").count(), 1, "one card per request");
  assert.equal(
    await page.locator('[data-message-id="question"] [data-agent-approval]').count(),
    0,
    "user prompt never owns approval cards",
  );
  await page.evaluate(() => chatTest.approval("closed"));
  await page.locator("[data-agent-approval]").waitFor({ state: "detached" });
  await groupTrigger.click();
  assert.equal(await tool.getAttribute("data-state"), "running");
  const trigger = tool.locator('[data-slot="trace-collapsible-trigger"]');
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  assert.equal(
    await tool
      .locator('[data-slot="code-block"] pre')
      .evaluate((pre) => getComputedStyle(pre).borderTopWidth),
    "0px",
    "Tool JSON shares the single-border CodeBlock treatment",
  );
  await page.evaluate(() => chatTest.append("Final reply.\n", true));
  await page.waitForFunction(
    () => document.querySelector('[data-slot="tool"]')?.dataset.state === "completed",
  );
  assert.equal(
    await trigger.getAttribute("aria-expanded"),
    "true",
    "stream update preserves manual expansion",
  );
  assert.match(
    await tool.locator('[data-slot="terminal-output"]').textContent(),
    /Build passed.*<script>/,
  );
  assert.equal(await tool.locator("script").count(), 0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.copiedOutput = text;
        },
      },
    }),
  );
  await tool.getByRole("button", { name: "Copy output", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.copiedOutput),
    "Build passed. <script>never execute</script>",
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  await tool.getByRole("button", { name: "Copy output", exact: true }).click();
  await tool.getByRole("alert").waitFor();

  await page.locator('[data-slot="inline-citation"]').first().click();
  assert.deepEqual(await page.evaluate(() => chatTest.opened), ["https://example.test/docs"]);
  await page.getByRole("link", { name: "Reference source", exact: true }).hover();
  await page.getByText("A safe source preview.", { exact: true }).waitFor();
  await tool.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/private/tmp/ovule-chat-elements.png" });
  const viewport = page.locator(".ui-message-scroller-viewport");
  await viewport.hover();
  await page.mouse.wheel(0, -10000);
  await page.waitForFunction(
    () => document.querySelector(".ui-message-scroller-viewport").scrollTop < 100,
  );
  await page.waitForFunction(() => {
    const node = document.querySelector(".ui-message-scroller-viewport");
    const animation = node
      .getAnimations()
      .find((item) => item.animationName === "scroll-fade-reveal-b");
    return animation?.effect.getComputedTiming().progress === 0;
  });
  const before = await viewport.evaluate((node) => node.scrollTop);
  await page.evaluate(() => chatTest.append("\n" + "More streaming text.\n".repeat(60)));
  await page.waitForFunction(() => document.body.textContent.includes("More streaming text."));
  await page.waitForTimeout(250);
  assert.ok(
    Math.abs((await viewport.evaluate((node) => node.scrollTop)) - before) < 3,
    "reading history is not pulled to live edge",
  );
  await page.getByRole("button", { name: "Jump to latest message", exact: true }).click();
  await page.waitForFunction(() => {
    const node = document.querySelector(".ui-message-scroller-viewport");
    return node.scrollHeight - node.clientHeight - node.scrollTop < 8;
  });
  // A new user turn must not reintroduce anchored-turn scrolling. Dragging the
  // scrollbar to the bottom resumes following without Jump to latest.
  await page.evaluate(() => chatTest.reanchor());
  await page.locator('[data-message-id="new-question"]').waitFor();
  await viewport.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  for (let index = 0; index < 4; index++) {
    await page.evaluate(() => chatTest.append("\n\n" + "Continuous streaming text. ".repeat(100)));
    await page.waitForFunction(() => {
      const node = document.querySelector(".ui-message-scroller-viewport");
      return node.scrollHeight - node.clientHeight - node.scrollTop < 8;
    });
  }
  await page.evaluate(() => {
    const row = document.querySelector('[data-message-id="reply"]');
    row.style.minHeight = `${row.getBoundingClientRect().height + 250}px`;
  });
  await page.waitForFunction(() => {
    const node = document.querySelector(".ui-message-scroller-viewport");
    return node.scrollHeight - node.clientHeight - node.scrollTop < 8;
  });
  await page.screenshot({ path: "/private/tmp/ovule-chat-stream.png" });
  await page.waitForFunction(() => {
    const node = document.querySelector(".ui-message-scroller-viewport");
    const animation = node
      .getAnimations()
      .find((item) => item.animationName === "scroll-fade-reveal-b");
    return animation?.effect.getComputedTiming().progress > 0.999;
  });
  // Check the actual composer class in both themes, independently of its services.
  await page.evaluate(() => {
    const group = document.createElement("div");
    group.className = `ui-input-group ${chatTest.composerClass}`;
    group.id = "focus-fixture";
    group.style.cssText =
      "position:fixed;bottom:20px;left:30px;width:400px;padding:20px;z-index:99";
    group.innerHTML =
      '<textarea aria-label="Focus fixture" placeholder="Message ovule..."></textarea>';
    document.body.append(group);
  });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.activeElement?.blur();
    }, theme);
    const group = page.locator("#focus-fixture");
    const resting = await group.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      shadow: getComputedStyle(node).boxShadow,
    }));
    await page.getByRole("textbox", { name: "Focus fixture" }).focus();
    await page.waitForTimeout(220);
    const focused = await group.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      shadow: getComputedStyle(node).boxShadow,
    }));
    assert.equal(
      focused.background,
      resting.background,
      `${theme} composer keeps its background on focus`,
    );
    assert.notEqual(focused.shadow, resting.shadow, `${theme} composer adds a focus glow`);
    await page.screenshot({ path: `/private/tmp/ovule-chat-focus-${theme}.png` });
  }
  await page.evaluate(() => {
    const scroller = document.createElement("div");
    scroller.className = "scroll-fade-b";
    scroller.id = "no-overflow";
    scroller.style.cssText = "height:100px;overflow:auto";
    scroller.textContent = "Short message";
    document.body.append(scroller);
  });
  await page.waitForTimeout(100);
  assert.equal(
    await page
      .locator("#no-overflow")
      .evaluate((node) => getComputedStyle(node).getPropertyValue("--scroll-fade-b")),
    "0px",
    "short conversations do not fade",
  );
  // A large transcript must mount a small tail, load backwards, and preserve
  // the visible turn while prepending. Offscreen Markdown must leave the DOM.
  await page.evaluate(() => {
    document.querySelector("#focus-fixture")?.remove();
    chatTest.history(2000);
  });
  await page.locator('[data-message-id="history-1999"]').waitFor();
  assert.ok((await page.locator("[data-message-id]").count()) <= 48, "initial history is bounded");
  await page.waitForFunction(() => document.querySelector('[data-virtual-message="placeholder"]'));
  assert.ok(
    (await page.locator('[data-virtual-message="mounted"]').count()) < 24,
    "offscreen message bodies are virtualized",
  );
  // Read near the start of the current batch without crossing the auto-load sentinel.
  await page.evaluate(() => {
    const node = document.querySelector(".ui-message-scroller-viewport");
    node.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    node.scrollTop = 380;
  });
  await page.waitForTimeout(200);
  const anchor = await page.locator("[data-message-id]").evaluateAll((rows) => {
    const viewport = document
      .querySelector(".ui-message-scroller-viewport")
      .getBoundingClientRect();
    const row = rows.find((row) => row.getBoundingClientRect().bottom > viewport.top + 40);
    return { id: row.dataset.messageId, top: row.getBoundingClientRect().top };
  });
  // Explicitly trigger the same preceding-page action without scrolling away from the anchor.
  await page
    .getByRole("button", { name: "Load earlier messages" })
    .evaluate((button) => button.click());
  await page.waitForFunction(() => document.querySelectorAll("[data-message-id]").length > 24);
  await page.waitForTimeout(150);
  const anchorAfter = await page
    .locator(`[data-message-id="${anchor.id}"]`)
    .evaluate((row) => row.getBoundingClientRect().top);
  assert.ok(
    Math.abs(anchorAfter - anchor.top) < 6,
    `prepending preserves the visible message position: ${anchor.id} ${anchor.top} -> ${anchorAfter}`,
  );
  await page.evaluate(() => chatTest.history(3, "switched"));
  await page.locator('[data-message-id="switched-2"]').waitFor();
  assert.equal(
    await page.locator("[data-message-id]").count(),
    3,
    "switching threads resets the loaded history",
  );
  assert.equal(
    await page.locator('[data-message-id^="history-"]').count(),
    0,
    "previous thread does not leak into the next thread",
  );
  const performanceSample = await page.evaluate(async () => {
    const started = performance.now();
    chatTest.history(10000, "benchmark");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      switchTo10000MessagesMs: Math.round(performance.now() - started),
      rows: document.querySelectorAll("[data-message-id]").length,
    };
  });
  assert.ok(performanceSample.rows <= 48, "10,000 messages still mount a bounded tail");
  console.log(`PERF ${JSON.stringify(performanceSample)}`);
  const completed = await browser.newPage({ viewport: { width: 920, height: 660 } });
  await completed.goto(`http://127.0.0.1:${server.address().port}`);
  await completed.locator("[data-tool-group]").waitFor();
  await completed.evaluate(() => chatTest.append("Done", true));
  const completedTrigger = completed.locator(
    '[data-tool-group] > [data-slot="trace-collapsible"] > [data-slot="trace-collapsible-trigger"]',
  );
  await completed.waitForFunction(
    () =>
      document
        .querySelector('[data-tool-group] [data-slot="trace-collapsible-trigger"]')
        ?.getAttribute("aria-expanded") === "false",
  );
  assert.equal(
    await completed.locator('[data-slot="tool"]').isVisible(),
    false,
    "completed tools do not occupy transcript height",
  );
  await completed.locator('[data-message-id="reply"]').evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations()
        .filter((animation) => animation.playState === "running")
        .map((animation) => animation.finished),
    );
  });
  await completed.screenshot({ path: "/private/tmp/ovule-tools-collapsed.png" });
  await completedTrigger.click();
  await completed.locator('[data-slot="tool"]').waitFor({ state: "visible" });
  await completed.close();
  await page.evaluate(() => chatTest.statuses("cancelled"));
  await page.getByText("Generation stopped", { exact: true }).waitFor();
  assert.match(
    await page.locator('[data-message-id="status-reply"]').textContent(),
    /Already checked/,
  );
  assert.equal(
    await page
      .locator('[data-message-id="status-reply"] article')
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "cancellation never paints the whole response red",
  );
  await page.evaluate(() => chatTest.statuses("legacy"));
  await page.getByText("Generation stopped", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Agent Worker was cancelled before it started", { exact: true }).count(),
    0,
    "legacy stop text is normalized",
  );
  await page.evaluate(() => chatTest.statuses("tools"));
  const statusGroup = page.locator("[data-tool-group]");
  await statusGroup.getByText("2 invocation errors", { exact: true }).waitFor();
  assert.match(await statusGroup.textContent(), /1 unsuccessful/);
  await statusGroup
    .locator(':scope > [data-slot="trace-collapsible"] > [data-slot="trace-collapsible-trigger"]')
    .click();
  assert.equal(await page.locator('[data-slot="tool"][data-state="error"]').count(), 2);
  assert.equal(await page.locator('[data-slot="tool"][data-state="failed"]').count(), 1);
  assert.equal(
    await statusGroup.locator('[data-status="error"]').count(),
    0,
    "tool names and group titles are not danger-colored",
  );
  await page.screenshot({ path: "/private/tmp/ovule-tool-statuses.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS Chat stream: real MessageList, Trace/Tool state and expansion, Terminal, citations, history scrolling and resume",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(output, { recursive: true, force: true });
}
