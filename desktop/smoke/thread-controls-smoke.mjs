import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
const temporary = await mkdtemp(path.join(tmpdir(), "ovule-thread-controls-"));
let browser, server;
try {
  execFileSync("bun", ["build", "./smoke/thread-controls-fixture.tsx", "--outdir", temporary]);
  server = createServer(async (req, res) => {
    if (req.url === "/fixture.js" || req.url === "/fixture.css") {
      const extension = req.url.endsWith(".js") ? "js" : "css";
      res.setHeader("Content-Type", extension === "js" ? "application/javascript" : "text/css");
      res.end(await readFile(path.join(temporary, `thread-controls-fixture.${extension}`)));
    } else
      res.end(
        '<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>',
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OVULE_BROWSER_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 720, height: 600 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Stopping…", exact: true }).isDisabled(),
    true,
  );
  assert.deepEqual(
    await page.evaluate(() => window.actions),
    [{ kind: "stop" }],
    "stop is not a form submission",
  );
  await page.evaluate(() => window.finishStop());
  await page.getByRole("button", { name: "Send message", exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit prompt", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit prompt", exact: true });
  assert.equal(await editor.inputValue(), "Original prompt");
  assert.equal(
    await editor.evaluate((element) => document.activeElement === element),
    true,
    "editing focuses the original bubble",
  );
  assert.equal(
    await page.locator("#original").count(),
    0,
    "original text is replaced instead of duplicated",
  );
  assert.equal(await editor.locator('xpath=ancestor::*[@data-slot="bubble"]').count(), 1);
  assert.equal(await page.getByRole("button", { name: /Cancel|Restart in new branch/ }).count(), 0);
  const box = await editor.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 720, "editor stays inside the bubble viewport");
  assert.equal(
    await page.locator('[data-slot="message"]').count(),
    1,
    "editing never duplicates the message",
  );
  await page.screenshot({
    path: "/private/tmp/ovule-inline-prompt-editor.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 600 });
  const narrow = await editor.boundingBox();
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 390, "editing remains responsive");
  await page.setViewportSize({ width: 720, height: 600 });
  await editor.fill("Edited <script>prompt</script>");
  await editor.press("End");
  await editor.press("Shift+Enter");
  await editor.press("Backspace");
  assert.equal(
    await page.evaluate(() => window.actions.length),
    1,
    "Shift+Enter inserts a newline without restarting",
  );
  await editor.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    ),
  );
  assert.equal(await page.evaluate(() => window.actions.length), 1, "IME Enter must not restart");
  await page.evaluate(() => {
    window.rejectRestart = true;
  });
  await editor.press("Enter");
  await page.getByRole("alert").waitFor();
  assert.equal(
    await editor.inputValue(),
    "Edited <script>prompt</script>",
    "failed edits remain recoverable",
  );
  await page.evaluate(() => {
    window.rejectRestart = false;
  });
  await editor.press("Enter");
  await editor.waitFor({ state: "detached" });
  assert.equal(await page.locator("#original").textContent(), "Edited <script>prompt</script>");
  assert.equal(await page.locator("#reply").textContent(), "New reply");
  assert.equal(await page.locator("script").filter({ hasText: "prompt" }).count(), 0);
  await page.getByRole("button", { name: "Fork from here", exact: true }).click();
  await page.waitForFunction(() => window.actions.at(-1)?.kind === "fork");
  await page.getByRole("button", { name: "Edit prompt", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit prompt", exact: true }).press("Escape");
  await editor.waitFor({ state: "detached" });
  assert.deepEqual(await page.evaluate(() => window.actions), [
    { kind: "stop" },
    { kind: "restart", text: "Edited <script>prompt</script>" },
    { kind: "restart", text: "Edited <script>prompt</script>" },
    { kind: "fork" },
  ]);
  assert.deepEqual(errors, []);
  console.log(
    "PASS Thread controls: stop without submission, pending cancellation, in-place editing, Enter/Shift+Enter/Escape, IME, retryable errors, replaced reply and explicit fork",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(temporary, { recursive: true, force: true });
}
