import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { main, port, availablePort, waitHttp, smokeRoot } from "./runner.mjs";
await main("spa-package", async (c) => {
  const manifest = JSON.parse(await readFile(join(c.packageRoot, "tuffite.json"), "utf8"));
  const assets = join(c.packageRoot, manifest.app.assetRoot ?? "assets");
  const client = join(assets, "desktop/dist/client");
  if (!existsSync(join(client, "index.html")))
    throw new Error(`Packaged SPA entry is missing: ${client}`);
  const number = await availablePort(port(c.opts.port, 0));
  const server = c.start(
    process.execPath,
    [
      join(smokeRoot, "static-spa-server.mjs"),
      client,
      String(number),
      join(assets, "desktop/dist/resources/web"),
    ],
    "preview",
  );
  await waitHttp(`http://127.0.0.1:${number}/`, server);
  await c.probe("spa-workbench-smoke.mjs", { OVULE_UI_URL: `http://127.0.0.1:${number}` });
  await c.probe("settings-smoke.mjs", { OVULE_UI_URL: `http://127.0.0.1:${number}/main` });
  console.log("spa_package_smoke=ok workbench=true workspace_center=true");
});
