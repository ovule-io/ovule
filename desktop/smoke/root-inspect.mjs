import { main } from "./runner.mjs";
import { windowsProbe } from "./platform/windows/adapter.mjs";
await main("root-inspect", async (c) => {
  if (process.platform !== "win32")
    throw new Error("This native UI suite requires an interactive Windows desktop");
  await c.claimPackage();
  // Production capability path deliberately has no remote debugging port.
  c.launch(null);
  console.log(await windowsProbe("root-inspect", c.packageRoot, c.artifacts));
});
