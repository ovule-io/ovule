import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  main,
  availablePort,
  run,
  waitHttp,
  projectRoot,
  desktopRoot,
  smokeRoot,
} from "./runner.mjs";

await main("lark-channel", async (c) => {
  await c.claimPackage();
  const extensionRoot =
    process.env.OVULE_CHANNEL_EXTENSION_ROOT ?? join(projectRoot, "plugins/channel-lark");
  assert.ok(
    existsSync(join(extensionRoot, "dist/host/worker.mjs")),
    "Build the private Lark extension before running its smoke adapter",
  );
  const sdkFixture = join(extensionRoot, "smoke/sdk-transport.mjs");
  if (existsSync(sdkFixture)) {
    await run(process.execPath, [sdkFixture], { cwd: extensionRoot });
  } else {
    console.log(
      "SKIP lark-sdk-transport: source fixture is absent from the selected extension root",
    );
  }
  const providerPort = await availablePort(0);
  const cdpPort = await availablePort(0);
  const fixture = join(c.artifacts, "channel-card-fixture.js");
  await run(
    "bun",
    [
      "build",
      "smoke/channel-card-fixture.ts",
      "--target",
      "browser",
      "--format",
      "iife",
      "--outfile",
      fixture,
    ],
    { cwd: desktopRoot },
  );
  Object.assign(c.env, {
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
    NO_PROXY: "*",
    no_proxy: "*",
    OVULE_FAKE_DEEPSEEK_PORT: String(providerPort),
    OVULE_TEST_MODE: "1",
    OVULE_TEST_DEEPSEEK_MODELS_ENDPOINT: `http://127.0.0.1:${providerPort}/models`,
    OVULE_TEST_DEEPSEEK_API_BASE: `http://127.0.0.1:${providerPort}`,
    DEEPSEEK_API_KEY: "sk-deepseek-native-smoke-1234567890",
    OVULE_CHANNEL_EXTENSION_ROOT: extensionRoot,
    OVULE_CHANNEL_EXTENSION_ID: "io.ovule.channel.lark",
    OVULE_SMOKE_SCOPE: "conversation-navigation",
    OVULE_SMOKE_CHANNEL_ACTIONS: "1",
    OVULE_CHANNEL_WORKER_MOCK: "1",
    OVULE_LARK_WORKER_MOCK: "1",
    OVULE_LARK_WORKER_MOCK_E2E: "1",
    OVULE_LARK_WORKER_MOCK_MANUAL_AUTH: "1",
    OVULE_CHANNEL_CARD_FIXTURE: fixture,
  });
  const provider = c.start(
    process.execPath,
    [join(smokeRoot, "fake-deepseek-server.mjs")],
    "fake-deepseek",
  );
  await waitHttp(`http://127.0.0.1:${providerPort}/channel-authorized`, provider);
  await run(
    "python3",
    ["scripts/smoke_native.py", "--package", c.packageRoot, "--port", String(cdpPort)],
    { cwd: projectRoot, env: c.env },
  );
});
