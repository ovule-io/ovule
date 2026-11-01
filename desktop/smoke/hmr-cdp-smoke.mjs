import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9238");
const expectedUrl = process.env.OVULE_DEV_URL ?? "http://127.0.0.1:5178/";
const expectedProbe = process.env.OVULE_HMR_PROBE;

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
let page;
try {
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(expectedUrl));
  assert.ok(page, `localhost application target is missing: ${expectedUrl}`);
  page.setDefaultTimeout(30_000);
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  const state = await page.evaluate(async () => ({
    bridge: typeof window.tuffite?.invoke,
    api: typeof (await import("/shell_api.js")).workspace.snapshot,
    threads: (await (await import("/shell_api.js")).workspace.snapshot()).threads.length,
    scripts: Array.from(document.scripts, (script) => script.src),
    viteClient: performance
      .getEntriesByType("resource")
      .some((entry) => entry.name.includes("/@vite/client")),
    navigationStart: performance.timeOrigin,
  }));
  assert.equal(state.bridge, "function");
  assert.equal(state.api, "function");
  assert.equal(state.threads, 0, "fresh HMR run must use the native SQLite snapshot");
  assert.ok(state.viteClient || state.scripts.some((script) => script.includes("/@vite/client")));
  const failures = [];
  page.on("console", (message) => {
    if (
      /ShellAPI transport unavailable|Failed to load extension slash commands/.test(message.text())
    )
      failures.push(message.text());
  });
  await page.evaluate(async () => {
    for (let batch = 0; batch < 40; batch++) {
      await Promise.all(
        Array.from({ length: 8 }, async () =>
          (await import("/shell_api.js")).extensions.extensionCatalog(),
        ),
      );
      await (await import("/shell_api.js")).workspace.snapshot();
    }
  });
  assert.deepEqual(failures, [], "Development ShellAPI must stay available during request bursts");
  console.log("dev_shell_api_pressure=ok requests=360");

  if (expectedProbe) {
    await page.waitForFunction(
      async (value) =>
        getComputedStyle(document.documentElement).getPropertyValue("--ovule-hmr-probe").trim() ===
        value,
      expectedProbe,
    );
    assert.equal(
      await page.evaluate(async () => performance.timeOrigin),
      state.navigationStart,
      "CSS HMR must not reload the application document",
    );
  }
  process.stdout.write(
    `hmr_smoke=ok url=${page.url()} bridge=true native_snapshot=true vite_client=true probe=${expectedProbe ?? "none"}\n`,
  );
} finally {
  if (page)
    await page
      .evaluate(async () => (await import("/tuffite.js")).window.close())
      .catch(() => undefined);
  await browser.close().catch(() => undefined);
}
