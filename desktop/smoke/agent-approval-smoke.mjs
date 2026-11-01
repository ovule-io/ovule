import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "ovule-inline-approval-"));
let browser, server;
try {
  execFileSync(
    "bun",
    [
      "build",
      "./smoke/agent-approval-fixture.tsx",
      "--external",
      "@ovule/shell-api",
      "--outdir",
      temporary,
    ],
    { cwd: desktop },
  );
  server = createServer(async (req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await readFile(path.join(temporary, "agent-approval-fixture.js")));
    } else if (req.url === "/style.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(await readFile(path.join(temporary, "agent-approval-fixture.css"), "utf8"));
    } else if (req.url === "/shell-api.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(
        `export const agent={
approvalMode:async()=>{const value=window.approvalMode||"ask";if(window.deferModeRead){await new Promise(resolve=>window.releaseModeRead=resolve);window.staleReadDelivered=true}return value},
setApprovalMode:async(mode)=>{if(window.deferModeWrite)await new Promise(resolve=>window.releaseModeWrite=resolve);if(window.rejectMode)throw new Error("fixture rejection");window.approvalMode=mode;return true},
respondApproval:async(id,allow)=>{window.hostPending=window.hostPending.filter(item=>item.requestId!==id);window.answers.push({id,allow});return true},
respondApprovalWithScope:async(id,allow,automatic)=>{window.hostPending=window.hostPending.filter(item=>item.requestId!==id);window.answers.push({id,allow,automatic});return true},
markApprovalPresented:async()=>true,
pendingApprovals:async(attemptId)=>window.hostPending.filter(item=>item.attemptId===attemptId).map(item=>({...item,argumentsJson:JSON.stringify(item.arguments),automaticAllowed:item.automaticAllowed!==false,reviewFallback:window.approvalMode==="review",expiresAtMs:BigInt(Date.now()+120000)}))
}`,
      );
    } else
      res.end(
        `<!doctype html><link rel="stylesheet" href="/style.css"><style>:root{--background:#fff;--foreground:#222;--border:#ddd;--muted-foreground:#777;--radius:8px;--font-size-ui:14px;--font-size-caption:12px}body{font-family:system-ui;margin:40px auto;max-width:720px;padding:0 16px}#approvals{margin:24px 0}input{padding:12px;width:90%}</style><script type="importmap">{"imports":{"@ovule/shell-api":"/shell-api.js"}}</script><article><p>Inspect the workspace</p><div id="approvals"></div><div id="approval-mode"></div></article><input aria-label="Message" placeholder="Message ovule..."><script type="module" src="/fixture.js"></script>`,
      );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.OVULE_BROWSER_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.request);
  const mode = page.getByRole("button", { name: "Approval mode", exact: true });
  await mode.waitFor();
  await mode.click();
  await page.getByRole("menuitemradio", { name: "Approve for me", exact: true }).click();
  await page.waitForFunction(() => window.approvalMode === "review");
  await mode.filter({ hasText: "Approve for me" }).waitFor();
  await mode.click();
  await page.getByRole("menuitemradio", { name: "Ask each time", exact: true }).click();
  await page.waitForFunction(() => window.approvalMode === "ask");
  await page.evaluate(() => {
    window.rejectMode = true;
  });
  await mode.click();
  await page.getByRole("menuitemradio", { name: "Approve for me", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Approval mode"]')?.title.includes("Could not change"),
  );
  assert.equal(
    await page.evaluate(() => window.approvalMode),
    "ask",
    "rejected mode changes preserve the host policy",
  );
  assert.equal(
    await page.evaluate(() => window.answers.length),
    0,
    "mode UI never responds to tool requests itself",
  );
  await page.evaluate(() => {
    window.rejectMode = false;
  });
  await page.evaluate(() => {
    window.deferModeWrite = true;
  });
  await mode.click();
  await page.getByRole("menuitemradio", { name: "Approve for me", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.releaseModeWrite));
  await page.evaluate(() => {
    window.deferModeRead = true;
  });
  await page.waitForFunction(() => Boolean(window.releaseModeRead));
  await page.evaluate(() => {
    window.deferModeWrite = false;
    window.releaseModeWrite();
  });
  await page.waitForFunction(
    () =>
      window.approvalMode === "review" &&
      !document.querySelector('[aria-label="Approval mode"]').disabled,
  );
  await page.evaluate(() => {
    window.deferModeRead = false;
    window.releaseModeRead();
  });
  await page.waitForFunction(() => window.staleReadDelivered);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.match(
    await mode.textContent(),
    /Approve for me/,
    "an old poll started during a write cannot overwrite the settled mode",
  );
  await mode.click();
  await page.getByRole("menuitemradio", { name: "Ask each time", exact: true }).click();
  await page.waitForFunction(() => window.approvalMode === "ask");
  const send = (request) => page.evaluate((request) => window.request(request), request);
  const request = (id) => ({
    kind: "request",
    requestId: id,
    attemptId: "test-attempt",
    tool: "test.tool",
    arguments: { text: "<img src=x onerror='window.injected=true'>" },
  });
  const first = "1".repeat(32),
    second = "2".repeat(32),
    third = "3".repeat(32),
    fourth = "4".repeat(32);
  await send(request("forged"));
  assert.equal(await page.locator('[data-slot="confirmation"]').count(), 0);
  await page.getByRole("textbox", { name: "Message" }).focus();
  await send(request(first));
  await send(request(second));
  await page.locator(`[data-agent-approval="${first}"]`).waitFor();
  assert.equal(await page.locator('[data-slot="confirmation"]').count(), 2);
  assert.equal(await page.locator('[role="dialog"]').count(), 0);
  assert.equal(
    await page
      .getByRole("textbox", { name: "Message" })
      .evaluate((node) => document.activeElement === node),
    true,
    "approval must not steal composer focus",
  );
  assert.equal(await page.locator('[data-slot="confirmation"] img').count(), 0);
  assert.match(await page.locator('[data-slot="confirmation"] pre').first().textContent(), /<img/);
  await page
    .locator(`[data-agent-approval="${first}"]`)
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await page.waitForFunction(() => window.answers.length === 1);
  assert.deepEqual(await page.evaluate(() => window.answers[0]), {
    id: first,
    allow: true,
    automatic: false,
  });
  await send({ kind: "closed", requestId: second });
  await page.locator('[data-slot="confirmation"]').waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => window.answers.length),
    1,
    "host cancellation cannot create a grant",
  );
  await send(request(third));
  await page.getByRole("button", { name: "Deny", exact: true }).focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.answers.length === 2);
  assert.deepEqual(await page.evaluate(() => window.answers[1]), {
    id: third,
    allow: false,
    automatic: false,
  });
  await page.locator('[data-slot="confirmation"]').waitFor({ state: "detached" });
  await send(request(fourth));
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Allow for this task", exact: true }).click();
  await page.waitForFunction(() => window.answers.length === 3);
  assert.deepEqual(await page.evaluate(() => window.answers[2]), {
    id: fourth,
    allow: true,
    automatic: true,
  });
  await page.locator('[data-slot="confirmation"]').waitFor({ state: "detached" });
  await send({ ...request("6".repeat(32)), automaticAllowed: false });
  await page.locator('[data-slot="confirmation"]').waitFor();
  assert.equal(await page.getByRole("checkbox").count(), 0);
  await send({ kind: "closed", requestId: "6".repeat(32) });
  await send({ ...request("7".repeat(32)), attemptId: "other-attempt" });
  assert.equal(
    await page.locator('[data-slot="confirmation"]').count(),
    0,
    "another attempt must not leak into this conversation",
  );
  await send({ kind: "closed", requestId: "7".repeat(32) });
  await send({
    ...request("8".repeat(32)),
    arguments: { argv: ["rm", "-rf", "dist"], reason: "The command runs in this project." },
    automaticAllowed: false,
  });
  await page.getByText("Run rm -rf dist?", { exact: true }).waitFor();
  await page
    .locator('[data-slot="confirmation"]')
    .screenshot({ path: "/private/tmp/ovule-inline-approval.png" });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.screenshot({ path: "/private/tmp/ovule-inline-approval-narrow.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await send({ kind: "closed", requestId: "8".repeat(32) });
  // Recover a request that arrived before this view subscribed: no event is sent.
  const replay = { ...request("b".repeat(32)), automaticAllowed: false };
  await page.evaluate((replay) => {
    window.hostPending.push(replay);
    window.showAttempt("test-attempt", true);
  }, replay);
  await page.locator(`[data-agent-approval="${replay.requestId}"]`).waitFor();
  await page.evaluate(() => {
    window.approvalMode = "review";
  });
  await page
    .getByText(
      "Approve for me is enabled. This command or permission scope requires your confirmation.",
      { exact: true },
    )
    .waitFor();
  await page.evaluate(() => {
    window.approvalMode = "ask";
  });
  await page
    .getByText(
      "Approve for me is enabled. This command or permission scope requires your confirmation.",
      { exact: true },
    )
    .waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page.waitForFunction(() => window.answers.length === 4);
  const missed = { ...request("c".repeat(32)), automaticAllowed: false };
  await page.evaluate((missed) => window.hostPending.push(missed), missed);
  await page.locator(`[data-agent-approval="${missed.requestId}"]`).waitFor();
  await page.getByRole("button", { name: "Deny", exact: true }).click();
  await page.waitForFunction(() => window.answers.length === 5);
  await page.evaluate(() => window.showAttempt("test-attempt", false));
  await send(request("5".repeat(32)));
  await page.locator('[data-slot="confirmation"]').waitFor();
  await send({ ...request("9".repeat(32)), attemptId: "unrelated-background-attempt" });
  await page.evaluate(() => window.dispose());
  await page.waitForFunction(() => window.answers.length === 6);
  assert.deepEqual(await page.evaluate(() => window.answers[5]), {
    id: "5".repeat(32),
    allow: false,
  });
  await send(request("5".repeat(32)));
  assert.equal(await page.locator('[data-slot="confirmation"]').count(), 0);
  assert.equal(
    await page.evaluate(() => window.answers.length),
    6,
    "closing a renderer must not deny an unrelated attempt",
  );
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.deepEqual(errors, []);
  console.log(
    "PASS inline approvals: host approval mode, rejected mode updates, attempt scoping, no modal or focus theft, inert preview, explicit consent, cancellation, one-call scope, responsive layout and disposal",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(temporary, { recursive: true, force: true });
}
