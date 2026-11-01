import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { join, basename, delimiter } from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { main, port, availablePort, waitHttp, run, smokeRoot, desktopRoot } from "./runner.mjs";
import { compileWindows, windowsProbe } from "./platform/windows/adapter.mjs";
await main("native-cdp", async (c) => {
  if (process.platform !== "win32")
    throw new Error(
      "native-cdp fixtures currently require Windows; use scripts/smoke_native.py on macOS/Linux",
    );
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9237));
  const workspace = join(c.root, "workspace"),
    bin = join(c.root, "fake-bin"),
    feed = join(c.root, "extension-feed"),
    downloads = join(c.root, "extension-downloads"),
    npmCache = join(c.root, "npm-cache");
  await Promise.all(
    [workspace, bin, feed, downloads, npmCache].map((path) => mkdir(path, { recursive: true })),
  );
  if (c.env.OVULE_CDP_SCOPE === "remote-control") {
    await Promise.all(
      ["agent-sample", "channel-sample"].map((name) =>
        access(join(smokeRoot, "fixtures", name, "dist/extension.mjs")),
      ),
    );
    console.log("third_party_extension_build=reused scope=remote-control");
  } else {
    await run("bun", ["run", "build:extensions"]);
    await run("bun", ["run", "test:fixtures"]);
  }
  const packed = {};
  for (const [id, name] of [
    ["sample", "agent-sample"],
    ["channel", "channel-sample"],
  ]) {
    const output = await run(
      "npm",
      [
        "pack",
        join(smokeRoot, "fixtures", name),
        "--json",
        "--pack-destination",
        feed,
        "--cache",
        npmCache,
      ],
      { capture: true },
    );
    packed[id] = join(feed, JSON.parse(output)[0].filename);
  }
  const feedPort = await availablePort(number + 3);
  const archives = new Map(
    await Promise.all(
      Object.values(packed).map(async (file) => [basename(file), await readFile(file)]),
    ),
  );
  const server = createServer((request, response) => {
    const bytes = archives.get(
      decodeURIComponent(new URL(request.url, "http://localhost").pathname.slice(1)),
    );
    response.writeHead(bytes ? 200 : 404);
    response.end(bytes);
  });
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(feedPort, "127.0.0.1", accept);
  });
  try {
    for (const [id, file] of Object.entries(packed)) {
      const response = await fetch(
        `http://127.0.0.1:${feedPort}/${encodeURIComponent(basename(file))}`,
      );
      if (!response.ok) throw new Error(`Extension download failed: ${id}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = (value) => createHash("sha256").update(value).digest("hex");
      if (digest(bytes) !== digest(await readFile(file)))
        throw new Error(`Extension checksum mismatch: ${id}`);
      const archive = join(downloads, basename(file)),
        unpacked = join(downloads, id);
      await writeFile(archive, bytes);
      await mkdir(unpacked);
      await run("tar", ["-xzf", archive, "-C", unpacked]);
      await access(join(unpacked, "package/extension.json"));
      c.env[`OVULE_CDP_${id.toUpperCase()}_EXTENSION`] = join(unpacked, "package");
    }
  } finally {
    await new Promise((accept) => server.close(accept));
  }
  console.log("third_party_extension_download=ok transport=http packages=sample,channel");
  const sample = join(bin, "sample.exe"),
    sampleAlias = join(bin, "sample-alias.exe"),
    codex = join(bin, "codex-acp.exe"),
    ollama = join(bin, "ollama.exe");
  await compileWindows(join(smokeRoot, "platform/windows/FakeAcpAgent.cs"), sample);
  await Promise.all([copyFile(sample, sampleAlias), copyFile(sample, codex)]);
  await compileWindows(join(smokeRoot, "platform/windows/FakeOllama.cs"), ollama);
  const ollamaPort = await availablePort(number + 1),
    deepSeekPort = await availablePort(number + 2);
  Object.assign(c.env, {
    OVULE_CDP_WORKSPACE: workspace,
    OVULE_CDP_OUTSIDE_PDF: join(c.root, "outside-office.pdf"),
    OVULE_CDP_ARTIFACTS: c.artifacts,
    OVULE_CDP_EXTENSION_FIXTURE: join(smokeRoot, "fixtures/install-extension"),
    OVULE_CDP_CHANNEL_SOURCE: join(smokeRoot, "fixtures/channel-sample"),
    OVULE_CDP_PORT: String(number),
    OVULE_TOOLCHAIN_SAMPLE: sample,
    OVULE_TOOLCHAIN_SAMPLE_ALIAS: sampleAlias,
    OVULE_TOOLCHAIN_CODEX: sample,
    OVULE_TOOLCHAIN_CODEX_ACP: codex,
    OVULE_TOOLCHAIN_OLLAMA: ollama,
    OVULE_CHANNEL_WORKER_MOCK: "1",
    OVULE_CHANNEL_WORKER_MOCK_E2E: "1",
    OVULE_CHANNEL_WORKER_MOCK_LOG: join(c.artifacts, "channel-worker.mock.jsonl"),
    PATH: `${bin}${delimiter}${c.env.PATH}`,
    OVULE_FAKE_OLLAMA_PORT: String(ollamaPort),
    OLLAMA_HOST: `127.0.0.1:${ollamaPort}`,
    OVULE_TEST_MODE: "1",
    OVULE_FAKE_DEEPSEEK_PORT: String(deepSeekPort),
    OVULE_TEST_DEEPSEEK_MODELS_ENDPOINT: `http://127.0.0.1:${deepSeekPort}/models`,
    OVULE_TEST_DEEPSEEK_API_BASE: `http://127.0.0.1:${deepSeekPort}`,
  });
  const fakeOllama = c.start(
    process.execPath,
    [join(smokeRoot, "fake-ollama-server.mjs")],
    "fake-ollama",
  );
  const fakeDeepSeek = c.start(
    process.execPath,
    [join(smokeRoot, "fake-deepseek-server.mjs")],
    "fake-deepseek",
  );
  await waitHttp(`http://127.0.0.1:${ollamaPort}/api/tags`, fakeOllama);
  await waitHttp(`http://127.0.0.1:${deepSeekPort}/models`, fakeDeepSeek, {
    Authorization: "Bearer sk-deepseek-native-smoke-1234567890",
  });
  let app = c.launch(number);
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  await c.probe("native-cdp-smoke.mjs");
  if (
    ["onboarding", "image", "office", "workflow", "computer-use", "remote-control"].includes(
      c.env.OVULE_CDP_SCOPE,
    )
  )
    return;
  const events = (await readFile(c.env.OVULE_CHANNEL_WORKER_MOCK_LOG, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const event of ["inbound", "send"])
    if (
      !events.some(
        (value) =>
          value.event === event && JSON.stringify(value).includes("CHANNEL_AGENT_ROUND_TRIP_OK"),
      )
    )
      throw new Error(`Channel round trip missing ${event}`);
  console.log(
    "native_channel_round_trip=ok pairing=true inbound=true agent=true outbox=true delivery=true",
  );
  await c.stop(app);
  await windowsProbe("stop", c.packageRoot);
  app = c.launch(number, { label: "native-restart", profile: "profile-restart" });
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  await c.probe("native-restart-smoke.mjs");
  await access(join(c.env.OVULE_DATA_DIR, "extensions/io-ovule-channel-sample")).then(
    () => {
      throw new Error("Removed Channel Extension files survived restart cleanup");
    },
    (error) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  console.log("extension_remove_cleanup=ok extension=channel-sample");
});
