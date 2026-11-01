import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { main, waitFor, projectRoot } from "./runner.mjs";
import { windowsProbe } from "./platform/windows/adapter.mjs";
await main("native-ui", async (c) => {
  if (process.platform !== "win32")
    throw new Error("This native UI suite requires an interactive Windows desktop");
  await c.claimPackage();
  const branding = JSON.parse(await readFile(join(projectRoot, "branding.json"), "utf8"));
  const marker = join(c.root, "window-surface.json");
  let app = c.launch(null, { extra: [`--tuffite-window-surface-test=${marker}`] });
  console.log(await windowsProbe("native-ui", c.packageRoot, c.artifacts, branding.displayName));
  if (!existsSync(join(c.env.OVULE_DATA_DIR, "workspace.sqlite3")))
    throw new Error("SQLite workspace was not initialized");
  const surface = async () => {
    await waitFor(() => existsSync(marker), "main-window compositor marker");
    return JSON.parse(await readFile(marker, "utf8"));
  };
  let result = await surface();
  if (result.status !== "ok" || !result.widget_visible || !result.view_showing) {
    await c.stop(app);
    await windowsProbe("stop", c.packageRoot);
    await rm(marker);
    app = c.launch(null, {
      label: "compositor-retry",
      profile: "profile-retry",
      extra: [`--tuffite-window-surface-test=${marker}`],
    });
    result = await surface();
  }
  if (result.status !== "ok" || !result.widget_visible || !result.view_showing)
    throw new Error(`Compositor validation failed: ${JSON.stringify(result)}`);
  console.log("native_ui_smoke=ok compositor=true");
});
