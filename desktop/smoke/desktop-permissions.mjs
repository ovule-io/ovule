import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, waitHttp, waitFor } from "./runner.mjs";

// Read-only OS checks: never change grants or display a permission prompt.
await main("desktop-permissions", async (c) => {
  await c.claimPackage();
  const manifest = JSON.parse(
    await readFile(
      join(
        c.packageRoot,
        process.platform === "darwin" ? "Contents/Resources/manifest.json" : "manifest.json",
      ),
      "utf8",
    ),
  );
  const port = await availablePort(0);
  const child = c.launch(port, { extra: ["--no-first-run"] });
  await waitHttp(`http://127.0.0.1:${port}/json/version`, child, undefined, 120000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = await waitFor(
      async () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((candidate) => candidate.url().startsWith("ovule://-/main")),
      "main window",
    );
    await page.locator(".titlebar").waitFor();
    const status = await page.evaluate(async () =>
      (await import("/shell_api.js")).workspace.desktopPermissions(),
    );
    assert.equal(typeof status.screenRecording, "boolean");
    assert.equal(typeof status.accessibility, "boolean");
    assert.equal(typeof status.inputMonitoring, "boolean");
    assert.equal(typeof status.appVersion, "string");
    assert.equal(status.expectedBundleId, manifest.application);
    assert.equal(status.managed, process.platform === "darwin");
    if (status.managed) assert.equal(status.bundleId, status.expectedBundleId);
    const rejected = await page.evaluate(async () => {
      try {
        await (await import("/shell_api.js")).workspace.requestDesktopPermission("invalid");
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(rejected, true);
    await page.evaluate(() => localStorage.setItem("ovule.onboarding.dismissed", "true"));
    await page.reload();
    await page.locator("[data-settings-toggle]").click();
    const panel = page.locator("[data-settings-panel]");
    const card = panel.locator("[data-desktop-permissions]");
    await panel.getByRole("button", { name: "General", exact: true }).click();
    await card.getByText("Permissions", { exact: true }).waitFor();
    assert.deepEqual(
      await panel
        .locator("[data-general-settings] > [data-general-section]")
        .evaluateAll((sections) => sections.map((section) => section.dataset.generalSection)),
      ["theme", "language", "search", "links", "downloads", "permissions", "about"],
    );
    if (status.managed) {
      const about = panel.locator("[data-about-ovule]");
      await about.getByText(status.bundleId, { exact: true }).waitFor();
      for (const name of ["screenRecording", "accessibility", "inputMonitoring"]) {
        assert.equal(
          await card
            .locator(`[data-permission="${name}"]`)
            .getByRole("button", { name: /^(Request access|Open settings)$/ })
            .count(),
          1,
        );
      }
      assert.equal(await card.locator('[data-permission="automation"] button').count(), 0);
      await card.getByRole("button", { name: "Refresh permissions", exact: true }).click();
      await card
        .locator("[data-permissions-feedback]")
        .filter({ hasText: "Permissions checked at" })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector("[data-desktop-permissions]")?.getAttribute("aria-busy") ===
          "false",
      );
    }
    await card.screenshot({ path: join(c.artifacts, "general-permissions.png") });
    await panel.getByRole("button", { name: "Hosts", exact: true }).click();
    await panel.locator("[data-host-power-control]").waitFor();
    await card.getByText("Permissions", { exact: true }).waitFor();
    await card.screenshot({ path: join(c.artifacts, "host-permissions.png") });
    console.log(
      `desktop_permissions=ok identity=${status.expectedBundleId} native_status=true general=true pairing_and_keep_awake=true refresh=true invalid_request_rejected=true os_grants_unchanged=true`,
    );
  } finally {
    await browser.close();
  }
});
