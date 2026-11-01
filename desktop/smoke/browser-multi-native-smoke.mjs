import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9254");
const firstBase = process.env.OVULE_BROWSER_FIRST ?? "http://127.0.0.1:4173/";
const secondBase = process.env.OVULE_BROWSER_SECOND ?? "http://127.0.0.1:4173/preview";
const runId = Date.now().toString(36);
const firstUrl = new URL(firstBase);
const secondUrl = new URL(secondBase);
firstUrl.searchParams.set("ovule-smoke", `${runId}-1`);
secondUrl.searchParams.set("ovule-smoke", `${runId}-2`);
const firstTarget = firstUrl.href;
const secondTarget = secondUrl.href;
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => isOvuleResource(candidate.url(), "index.html"));
  assert.ok(page, "Ovule app target was not exposed over CDP");
  page.setDefaultTimeout(30_000);
  await page.evaluate(() => localStorage.setItem("ovule.onboarding.dismissed", "true"));
  await page.reload();
  await page.getByRole("button", { name: "Browser use", exact: true }).waitFor();
  await page.waitForTimeout(500);
  const tabs = page.getByRole("tab", { name: /Browser/ });
  const surfaces = page.locator(".harness-tab-content explorer[title='Browser']");
  const before = await tabs.count();
  const beforeSurfaces = await surfaces.count();
  await page.evaluate((target) => {
    window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: { target } }));
  }, firstTarget);
  await page.waitForFunction(
    (count) => document.querySelectorAll("[role='tab']").length >= count,
    before + 1,
  );
  await page.evaluate((target) => {
    window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: { target } }));
  }, secondTarget);
  await page.waitForFunction(
    (count) => document.querySelectorAll("[role='tab']").length >= count,
    before + 2,
  );
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".harness-tab-content explorer[title='Browser']").length >= count,
    beforeSurfaces + 2,
  );
  await surfaces.nth(beforeSurfaces + 1).waitFor({ state: "attached" });
  assert.ok((await surfaces.count()) >= beforeSurfaces + 2);
  const sources = await surfaces.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("src")),
  );
  assert.deepEqual(sources.slice(-2), [firstTarget, secondTarget]);
  let explorerUrls = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    explorerUrls = targets
      .filter((candidate) => candidate.type === "webview")
      .map((candidate) => candidate.url);
    if (explorerUrls.includes(firstTarget) && explorerUrls.includes(secondTarget)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(explorerUrls.includes(firstTarget), JSON.stringify(explorerUrls));
  assert.ok(explorerUrls.includes(secondTarget), JSON.stringify(explorerUrls));
  process.stdout.write(
    `${JSON.stringify({ browserTabs: await tabs.count(), surfaces: await surfaces.count(), explorerUrls })}\n`,
  );
} finally {
  await browser.close();
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ovule:" &&
      url.host === "main" &&
      url.pathname.startsWith("/desktop/") &&
      url.pathname.endsWith(`/${filename}`)
    );
  } catch {
    return false;
  }
}
