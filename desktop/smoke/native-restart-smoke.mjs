import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9227");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => isOvuleResource(candidate.url(), "index.html"));
  assert.ok(page, "restarted Ovule app target was not exposed over CDP");
  page.setDefaultTimeout(30_000);
  await page.getByRole("button", { name: "New Conversation", exact: true }).waitFor();
  const snapshot = await page.evaluate(async () =>
    (await import("/shell_api.js")).workspace.snapshot(),
  );
  const chartMessage = snapshot.messages.find(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) => part.kind === "echarts" && part.dataJson?.includes("ECHARTS_CDP_OK"),
      ),
  );
  assert.ok(chartMessage, "persisted ECharts Message Block was missing after process restart");
  const thread = snapshot.threads.find((candidate) => candidate.id === chartMessage.threadId);
  assert.ok(thread, "persisted ECharts Thread was missing after process restart");
  // Existing `webview` targets predate this CDP connection and are not adopted
  // by Playwright. Recreate the Thread surface after connecting, which also
  // verifies that switching sessions replaces the isolated WebContents.
  await page.getByRole("button", { name: "New Conversation", exact: true }).click();
  await waitFor(async () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .some(
        (candidate) =>
          !candidate.isClosed() &&
          isOvuleResource(candidate.url(), "thread.html") &&
          new URL(candidate.url()).searchParams.get("thread") === "",
      ),
  );
  await page.locator(".thread-row", { hasText: thread.title }).click();
  const activeThreadPage = async () => {
    const candidates = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((candidate) => {
        if (candidate.isClosed() || !isOvuleResource(candidate.url(), "thread.html")) return false;
        return new URL(candidate.url()).searchParams.get("thread") === thread.id;
      })
      .reverse();
    for (const candidate of candidates) {
      if (
        await candidate
          .getByRole("textbox", { name: "Message" })
          .isVisible({ timeout: 250 })
          .catch(() => false)
      )
        return candidate;
    }
    return undefined;
  };
  const threadPage = await waitFor(activeThreadPage);
  threadPage.setDefaultTimeout(30_000);
  const chart = await waitFor(async () => {
    const currentThreadPage = await activeThreadPage();
    if (!currentThreadPage) return undefined;
    return currentThreadPage.evaluate(async () => {
      const hosts = document.querySelectorAll('[data-message-block-kind="echarts"]');
      const host = hosts.item(hosts.length - 1);
      if (!(host instanceof HTMLElement)) return undefined;
      const element = host.shadowRoot?.querySelector("[role='img']");
      const canvas = element?.querySelector("canvas");
      return canvas
        ? {
            label: element?.getAttribute("aria-label"),
            width: canvas.clientWidth,
            upgraded: host.getAttribute("data-custom-element"),
            registry: host.getAttribute("data-registry"),
          }
        : undefined;
    });
  });
  assert.equal(chart.label, "ECHARTS_CDP_OK");
  assert.equal(chart.upgraded, "upgraded");
  assert.ok(chart.width > 0);
  assert.ok(["scoped", "isolated-tag-fallback"].includes(chart.registry));
  assert.equal(
    await (await activeThreadPage())
      .locator('[data-message-role="assistant"]', { hasText: "ovule-block" })
      .count(),
    0,
  );
  process.stdout.write(
    `native_restart_smoke=ok sqlite_message=true custom_element=true registry=${chart.registry} canvas=true\n`,
  );
} finally {
  await browser.close();
}

async function waitFor(probe, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for persisted ECharts canvas after restart");
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ovule:" &&
      url.host === "-" &&
      url.pathname === (filename === "thread.html" ? "/thread" : "/main")
    );
  } catch {
    return false;
  }
}
