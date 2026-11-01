import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main, port, availablePort, waitHttp, waitFor, smokeRoot } from "./runner.mjs";
import { windowsProbe } from "./platform/windows/adapter.mjs";
await main("explorer-inspect", async (c) => {
  if (process.platform !== "win32")
    throw new Error("This native UI suite requires an interactive Windows desktop");
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9362));
  const ready = join(c.root, "inspect-menu-ready.json"),
    result = join(c.root, "inspect-result.json");
  const pickerReady = join(c.artifacts, "picker-ready.json"),
    captured = join(c.artifacts, "picker-captured.json");
  const before = join(c.artifacts, "app-before-picker.png"),
    after = join(c.artifacts, "app-after-picker.png"),
    native = join(c.artifacts, "native-picker.png");
  Object.assign(c.env, {
    OVULE_CDP_PORT: String(number),
    OVULE_INSPECT_URL: c.opts["target-url"] ?? "",
    OVULE_INSPECT_FIXTURE_PORT: String(number + 1),
    OVULE_INSPECT_READY_FILE: ready,
    OVULE_INSPECT_RESULT_FILE: result,
    OVULE_INSPECT_BEFORE_SCREENSHOT: before,
    OVULE_INSPECT_AFTER_SCREENSHOT: after,
    OVULE_INSPECT_PICKER_READY_FILE: pickerReady,
    OVULE_INSPECT_PICKER_CAPTURED_FILE: captured,
  });
  const app = c.launch(number);
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  await windowsProbe("foreground", c.packageRoot);
  const probe = c.start(
    process.execPath,
    [join(smokeRoot, "explorer-inspect-element-smoke.mjs")],
    "inspect",
  );
  await waitFor(() => existsSync(ready), "Explorer Inspect element menu", 60000);
  console.log(await windowsProbe("inspect-menu", c.packageRoot));
  await waitFor(() => existsSync(pickerReady), "native picker capture", 60000);
  const capture = JSON.parse(await windowsProbe("explorer-capture", c.packageRoot, native));
  await writeFile(captured, JSON.stringify({ ...capture, screenshot: native }));
  await waitFor(() => existsSync(result), "inspect verification result", 90000);
  const value = JSON.parse(await readFile(result, "utf8"));
  if (
    value.status !== "ok" ||
    !value.connected ||
    value.highlightPaths < 1 ||
    capture.overlayPixels < 250 ||
    !existsSync(before) ||
    !existsSync(after)
  )
    throw new Error(
      `Invalid Inspect result: ${JSON.stringify(value)} overlayPixels=${capture.overlayPixels}`,
    );
  await c.stop(probe);
  console.log(
    `explorer_picker_overlay=ok overlay_pixels=${capture.overlayPixels} screenshot=${native}`,
  );
});
