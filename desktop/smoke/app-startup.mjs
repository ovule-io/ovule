import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { chromium } from "playwright-core";
import { main, availablePort, waitHttp, waitFor } from "./runner.mjs";

// Exercise native package layout with isolated profiles, including macOS .app bundles.
await main("app-startup", async (c) => {
  await c.claimPackage();
  const identity = join(c.env.OVULE_DATA_DIR, "secrets/workspace-link-host.dpapi");
  const unreadable = Buffer.concat([Buffer.from("ovule-keychain-v1\0"), Buffer.alloc(28)]);
  if (c.opts["invalid-link-identity"]) {
    await mkdir(join(c.env.OVULE_DATA_DIR, "secrets"), { recursive: true });
    await writeFile(identity, unreadable);
  }
  const port = await availablePort(0);
  if (c.opts["finder-launch"] && process.platform !== "darwin") {
    throw new Error("--finder-launch requires macOS LaunchServices");
  }
  const app = c.opts["finder-launch"]
    ? c.start(
        "/usr/bin/open",
        [
          "-n",
          "-W",
          "--stderr",
          join(c.artifacts, "finder.stderr.log"),
          "--env",
          `OVULE_DATA_DIR=${c.env.OVULE_DATA_DIR}`,
          c.packageRoot,
          "--args",
          "--lang=en-US",
          `--user-data-dir=${join(c.root, "profile")}`,
          `--log-file=${join(c.artifacts, "native.log")}`,
          `--remote-debugging-port=${port}`,
          "--no-first-run",
        ],
        "finder",
      )
    : c.launch(port, { extra: ["--no-first-run"] });
  // First launch of a newly signed x64 bundle through Rosetta can be slow.
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
    await page.locator(".titlebar").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
    await page.locator(".onboarding-page article").first().waitFor({ timeout: 60000 });
    assert.equal(app.exitCode, null);
    assert.equal(app.signalCode, null);
    // Real native download bridge; every file stays under the isolated run root.
    // Startup must not depend on renderer-only Path RPCs.
    const source = join(c.root, "profile", "Downloads", "startup-smoke", "report.txt");
    const destination = join(c.root, "download-destination");
    await mkdir(join(source, ".."), { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(source, "native download startup regression");
    const published = await page.evaluate(
      async ({ source, destination }) => {
        const { browser: downloads } = await import("/shell_api.js");
        await downloads.setDownloadDirectory(destination);
        const item = await downloads.publishDownload(source, "https://example.test/report.txt");
        const rows = await downloads.listDownloads();
        return { item, listed: rows.some((row) => row.id === item.id) };
      },
      { source, destination },
    );
    assert.equal(published.listed, true);
    assert.equal(published.item.path, join(await realpath(destination), "report.txt"));
    assert.equal(await readFile(published.item.path, "utf8"), "native download startup regression");
    await page.evaluate(async (id) => {
      const { browser: downloads } = await import("/shell_api.js");
      if (!(await downloads.removeDownload(id))) throw new Error("Native download deletion failed");
    }, published.item.id);
    await assert.rejects(readFile(published.item.path), { code: "ENOENT" });
    assert.equal(await readFile(source, "utf8"), "native download startup regression");
    if (c.opts["invalid-link-identity"]) {
      assert.deepEqual(await readFile(identity), unreadable);
    }
    await page.screenshot({ path: join(c.artifacts, "startup.png") });
    console.log(`app_startup_smoke=ok native_download_bridge=ok url=${page.url()}`);
  } finally {
    if (c.opts["finder-launch"]) {
      const session = await browser.newBrowserCDPSession();
      await session.send("Browser.close").catch(() => {});
    }
    await browser.close();
  }
});
