import { main, port, availablePort, waitHttp, waitFor } from "./runner.mjs";
import { windowsProbe } from "./platform/windows/adapter.mjs";
await main("process-exit", async (c) => {
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9437));
  const app = c.launch(number, { extra: ["--no-first-run"] });
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  await c.probe("process-exit-smoke.mjs", { OVULE_EXIT_CDP_PORT: String(number) });
  await waitFor(
    async () =>
      process.platform === "win32"
        ? !(await windowsProbe("processes", c.packageRoot)).trim()
        : app.exitCode !== null || app.signalCode !== null,
    "all application processes to exit",
  );
  console.log("process_exit_smoke=ok root_exited=true children_exited=true");
});
