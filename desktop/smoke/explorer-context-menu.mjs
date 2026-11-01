import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { main, port, availablePort, waitHttp, waitFor, smokeRoot } from "./runner.mjs";
import { windowsProbe } from "./platform/windows/adapter.mjs";
await main("explorer-context-menu", async (c) => {
  if (process.platform !== "win32")
    throw new Error("This native UI suite requires an interactive Windows desktop");
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9261));
  Object.assign(c.env, {
    OVULE_CDP_PORT: String(number),
    OVULE_CONTEXT_MENU_URL: c.opts["target-url"] ?? "",
    OVULE_CONTEXT_MENU_HOLD_MS: "5000",
  });
  const app = c.launch(number);
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  const probe = c.start(
    process.execPath,
    [join(smokeRoot, "explorer-context-menu-smoke.mjs")],
    "probe",
  );
  const stdout = join(c.artifacts, "probe.stdout.log");
  const line = await waitFor(
    async () =>
      (await readFile(stdout, "utf8"))
        .split(/\r?\n/)
        .find((value) => value.startsWith("context_menu_probe=")),
    "context-menu click coordinates",
    20000,
  );
  const click = JSON.parse(line.slice("context_menu_probe=".length));
  console.log(
    await windowsProbe("context-menu", c.packageRoot, click.clickScreenX, click.clickScreenY),
  );
  await waitFor(() => probe.exitCode !== null, "context menu probe completion");
  const output = await readFile(stdout, "utf8");
  console.log(output);
  if (probe.exitCode !== 0 || !output.includes('"status":"ok"'))
    throw new Error("Context menu probe failed");
});
