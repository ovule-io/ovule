import { main, port, availablePort, waitHttp } from "./runner.mjs";
await main("thread-surface", async (c) => {
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9247));
  Object.assign(c.env, {
    OVULE_CDP_PORT: String(number),
    OVULE_STRESS_ITERATIONS: String(c.opts["stress-iterations"] ?? 30),
    OVULE_TOOLCHAIN_CODEX_ACP: process.execPath,
  });
  const app = c.launch(number, { singleProcess: true, extra: ["--no-first-run"] });
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  await c.probe(c.opts.stress ? "thread-surface-stress.mjs" : "thread-surface-native-smoke.mjs");
});
