import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { main, port, availablePort, waitHttp } from "./runner.mjs";
import { relayOptions } from "./relay-options.mjs";
await main("remote-control-e2e", async (c) => {
  const relay = relayOptions(c.opts);
  await c.claimPackage();
  const hostPort = await availablePort(port(c.opts["host-port"], 9257));
  const clientPort = await availablePort(port(c.opts["client-port"], 9258));
  if (hostPort === clientPort) throw new Error("Host and client ports must differ");
  const secret = "0123456789abcdef0123456789abcdef";
  Object.assign(c.env, {
    OVULE_TEST_MODE: "1",
    OVULE_E2E_SCOPE: c.opts["connection-only"]
      ? "connection"
      : c.opts["controller-only"]
        ? "controller"
        : "full",
    OVULE_E2E_ACCESS_FIXTURE: c.opts["corrupt-host-access"] ? "corrupt" : "legacy",
  });
  for (const key of [
    "OVULE_TURN_URLS",
    "OVULE_TURN_SHARED_SECRET",
    "OVULE_TURN_SHARED_SECRET_FILE",
  ]) {
    delete c.env[key];
  }
  const secrets = join(c.root, "host-data/secrets"),
    fixture = join(secrets, "workspace-link-access.json");
  await mkdir(secrets, { recursive: true });
  if (c.opts["require-relay"]) {
    // Copy the encrypted Host configuration into the isolated test profile.
    // SecretStore performs decryption; no plaintext credentials enter this runner.
    if (relay.credentials)
      await copyFile(relay.credentials, join(secrets, "provider-cloudflare-turn.dpapi"));
  }
  await writeFile(
    fixture,
    c.opts["corrupt-host-access"]
      ? "broken authorization fixture"
      : JSON.stringify({
          protocol_major: 5,
          pairing_token: "legacy-fixture-invitation-token",
          shares: {},
          devices: {},
        }),
  );
  const host = c.launch(hostPort, {
    label: "host",
    profile: "host-browser",
    singleProcess: process.platform === "win32",
    extra: ["--vmodule=input_injector_win=3"],
    extraEnv: {
      OVULE_DATA_DIR: join(c.root, "host-data"),
      ...(c.opts["host-owned-turn-fixture"]
        ? {
            OVULE_TURN_URLS: "turn:127.0.0.1:9?transport=udp",
            OVULE_TURN_SHARED_SECRET: secret,
          }
        : {}),
    },
  });
  await waitHttp(`http://127.0.0.1:${hostPort}/json/version`, host);
  if (relay.setup) {
    console.log(
      `Cloudflare setup: finish sign-in and enable the service in the isolated Host window. Encrypted profile: ${join(c.root, "host-data")}`,
    );
    await c.probe("cloudflare-manual-setup.mjs", {
      OVULE_E2E_HOST_PORT: String(hostPort),
      OVULE_E2E_SETUP_TIMEOUT_MS: String(Number(c.opts["setup-timeout-seconds"] ?? 600) * 1000),
    });
  }
  const client = c.launch(clientPort, {
    label: "client",
    profile: "client-browser",
    singleProcess: process.platform === "win32",
    extraEnv: { OVULE_DATA_DIR: join(c.root, "client-data") },
  });
  await waitHttp(`http://127.0.0.1:${clientPort}/json/version`, client);
  try {
    await c.probe("remote-control-e2e-smoke.mjs", {
      OVULE_E2E_HOST_PORT: String(hostPort),
      OVULE_E2E_CLIENT_PORT: String(clientPort),
      OVULE_E2E_TIMEOUT_MS: String(Number(c.opts["timeout-seconds"] ?? 90) * 1000),
      OVULE_E2E_HOST_PID: String(host.pid),
      OVULE_E2E_PACKAGE_ROOT: c.packageRoot,
      OVULE_E2E_TURN_FIXTURE: c.opts["host-owned-turn-fixture"] ? "1" : "0",
      OVULE_E2E_REQUIRE_RELAY: c.opts["require-relay"] ? "1" : "0",
      OVULE_E2E_TURN_TRANSPORT: relay.transport,
      OVULE_E2E_RESET_HOST_IDENTITY: c.opts["reset-host-identity"] ? "1" : "0",
    });
  } finally {
    if (relay.credentials)
      await rm(join(secrets, "provider-cloudflare-turn.dpapi"), { force: true });
  }
  if (c.opts["host-owned-turn-fixture"]) {
    const logs =
      (await readFile(join(c.artifacts, "host.log"), "utf8")) +
      (await readFile(join(c.artifacts, "host.stderr.log"), "utf8"));
    if (
      logs.includes(secret) ||
      !logs.includes("username: [redacted]") ||
      !logs.includes("password: [redacted]") ||
      /password: (?!\[redacted\])\S+/.test(logs)
    )
      throw new Error("Host TURN credentials were not redacted");
    console.log(
      "remote_control_turn_log_redaction=ok username=true password=true shared_secret_absent=true",
    );
  }
  const value = JSON.parse(await readFile(fixture, "utf8"));
  if (value.schema_version !== 1 || "protocol_major" in value)
    throw new Error("Host authorization schema was not migrated");
  console.log("remote_control_dual_instance_runner=ok");
});
