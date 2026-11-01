import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, waitHttp, waitFor } from "./runner.mjs";

// No sleep is triggered: inspect the OS request while an isolated Host runs.
await main("host-power", async (c) => {
  await c.claimPackage();
  const assertions = (pid) => {
    if (process.platform !== "darwin") return [];
    const text = execFileSync("/usr/bin/pmset", ["-g", "assertions"], { encoding: "utf8" });
    return text
      .split("\n")
      .filter(
        (line) => new RegExp(`pid\\s*${pid}\\b`).test(line) && line.includes("Ovule Remote Host"),
      );
  };
  const checkAssertion = async (pid, active) => {
    if (process.platform !== "darwin") return;
    await waitFor(
      () => assertions(pid).length === (active ? 1 : 0),
      "process-owned macOS power assertion",
    );
    if (active) assert.match(assertions(pid)[0], /PreventUserIdleSystemSleep/);
  };
  const start = async (label) => {
    const port = await availablePort(0);
    const child = c.launch(port, {
      label,
      extra: process.platform === "win32" ? [] : ["--headless", "--no-sandbox"],
      singleProcess: process.platform === "win32",
    });
    await waitHttp(`http://127.0.0.1:${port}/json/version`, child);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await waitFor(async () => {
      for (const candidate of browser.contexts().flatMap((value) => value.pages())) {
        if (
          await candidate
            .evaluate(
              async () =>
                typeof (await import("/shell_api.js")).workspace.hostPowerStatus === "function",
            )
            .catch(() => false)
        )
          return candidate;
      }
    }, "Host power API");
    await page.evaluate(async () => localStorage.setItem("ovule.onboarding.dismissed", "true"));
    await page.reload();
    return { child, browser, page };
  };
  const control = async (page) => {
    const panel = page.locator("[data-settings-panel]");
    if (!(await panel.isVisible())) await page.locator("[data-settings-toggle]").click();
    await panel.getByRole("button", { name: "Hosts", exact: true }).click();
    const widget = panel.locator("[data-host-power-control]");
    const toggle = widget.getByRole("switch", { name: "Keep this Host awake", exact: true });
    await toggle.waitFor();
    await waitFor(async () => !(await toggle.isDisabled()), "Host power switch ready");
    return { widget, toggle };
  };
  let running = await start("first");
  try {
    const initial = await running.page.evaluate(async () =>
      (await import("/shell_api.js")).workspace.hostPowerStatus(),
    );
    assert.equal(initial.keepAwake, false);
    assert.equal(initial.active, false);
    assert.equal(initial.supported, true);
    let ui = await control(running.page);
    assert.equal(await ui.toggle.isChecked(), false);
    await ui.toggle.click();
    await waitFor(
      () =>
        running.page.evaluate(async () => {
          const state = await (await import("/shell_api.js")).workspace.hostPowerStatus();
          return state.keepAwake && state.active && !state.error;
        }),
      "native idle sleep prevention",
    );
    await checkAssertion(running.child.pid, true);
    await running.page.reload();
    ui = await control(running.page);
    assert.equal(await ui.toggle.isChecked(), true);
    await checkAssertion(running.child.pid, true);
    await ui.widget.screenshot({ path: join(c.artifacts, "host-keep-awake.png") });
    const oldPid = running.child.pid;
    await c.stop(running.child); // Deliberate crash: the OS must release the request too.
    await running.browser.close();
    await checkAssertion(oldPid, false);
    running = await start("restored");
    await waitFor(
      () =>
        running.page.evaluate(
          async () => (await (await import("/shell_api.js")).workspace.hostPowerStatus()).active,
        ),
      "saved preference applied at app startup",
    );
    await checkAssertion(running.child.pid, true);
    ui = await control(running.page);
    assert.equal(await ui.toggle.isChecked(), true);
    await ui.toggle.click();
    await waitFor(
      () =>
        running.page.evaluate(async () => {
          const state = await (await import("/shell_api.js")).workspace.hostPowerStatus();
          return !state.keepAwake && !state.active;
        }),
      "turning off releases the native request",
    );
    await checkAssertion(running.child.pid, false);
    const preference = JSON.parse(await readFile(join(c.root, "data/host-power.json"), "utf8"));
    assert.equal(preference.keepAwake, false);
    console.log(
      `host_power=ok switch=true native_request=true renderer_reload=true no_duplicate_request=true startup_restore=true disable_releases=true crash_releases=${process.platform === "darwin"} remote_session_required=false`,
    );
  } finally {
    await running.browser.close().catch(() => {});
  }
});
