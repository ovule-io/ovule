import { join } from "node:path";
import { main, availablePort, run, waitHttp, projectRoot, smokeRoot } from "./runner.mjs";

await main("core-native", async (c) => {
  await c.claimPackage();
  const port = await availablePort(0);
  const providerPort = await availablePort(0);
  Object.assign(c.env, {
    OVULE_FAKE_DEEPSEEK_PORT: String(providerPort),
    OVULE_TEST_MODE: "1",
    OVULE_TEST_DEEPSEEK_MODELS_ENDPOINT: `http://127.0.0.1:${providerPort}/models`,
    OVULE_TEST_DEEPSEEK_API_BASE: `http://127.0.0.1:${providerPort}`,
    DEEPSEEK_API_KEY: "sk-deepseek-native-smoke-1234567890",
  });
  const provider = c.start(
    process.execPath,
    [join(smokeRoot, "fake-deepseek-server.mjs")],
    "fake-deepseek",
  );
  await waitHttp(`http://127.0.0.1:${providerPort}/channel-authorized`, provider);
  await run(
    "python3",
    [
      join(projectRoot, "scripts/smoke_native.py"),
      "--package",
      c.packageRoot,
      "--port",
      String(port),
    ],
    { cwd: projectRoot, env: c.env },
  );
});
