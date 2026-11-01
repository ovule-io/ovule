import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  closeSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { windowsProbe } from "./platform/windows/adapter.mjs";
export { sleep };
export const smokeRoot = dirname(fileURLToPath(import.meta.url));
export const desktopRoot = resolve(smokeRoot, "..");
export const projectRoot = resolve(desktopRoot, "..");
const flags = new Set([
  "stress",
  "single-process",
  "keep-run-root",
  "corrupt-host-access",
  "invalid-link-identity",
  "finder-launch",
  "controller-only",
  "connection-only",
  "host-owned-turn-fixture",
  "require-relay",
  "cloudflare-setup",
  "reset-host-identity",
  "help",
]);
export function options(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!/^--[a-z][a-z-]*$/.test(key)) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    if (flags.has(name)) result[name] = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
      result[name] = value;
    }
  }
  return result;
}
export function port(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 0 || number > 65535)
    throw new Error(`Invalid port: ${value}`);
  return number;
}
export async function availablePort(value) {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(value, "127.0.0.1", accept);
  });
  const number = server.address().port;
  await new Promise((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return number;
}
export async function waitFor(probe, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ""}`);
}
export async function waitHttp(url, child, headers, timeout = 30000) {
  await waitFor(
    async () => {
      if (child && child.exitCode !== null)
        throw new Error(`Process exited with ${child.exitCode}`);
      return (await fetch(url, { headers, signal: AbortSignal.timeout(1000) })).ok;
    },
    url,
    timeout,
  );
}
export function singleProcessArguments(enabled) {
  return enabled
    ? [
        "--no-sandbox",
        "--single-process",
        "--in-process-gpu",
        "--enable-features=NetworkServiceInProcess2",
        "--disable-features=AudioServiceOutOfProcess,CalculateNativeWinOcclusion,DirectCompositorThreadIpc",
      ]
    : [];
}
export async function run(
  command,
  args,
  { cwd = desktopRoot, env = process.env, capture = false } = {},
) {
  // npm.cmd is a batch file. Run npm's JavaScript CLI directly on Windows.
  if (process.platform === "win32" && command === "npm") {
    const launcher = execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8", windowsHide: true })
      .trim()
      .split(/\r?\n/)[0];
    args = [join(dirname(launcher), "node_modules/npm/bin/npm-cli.js"), ...args];
    command = process.execPath;
  }
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? accept(output) : reject(new Error(`${command} failed (${code ?? signal})`)),
    );
  });
}
export function packageExecutable(packageRoot) {
  const bundle = existsSync(join(packageRoot, "Contents/Resources/manifest.json"));
  const path = bundle
    ? join(packageRoot, "Contents/Resources/manifest.json")
    : join(packageRoot, "manifest.json");
  const name = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8")).executable
    : process.platform === "win32"
      ? "ovule.exe"
      : "ovule";
  if (
    typeof name !== "string" ||
    !name ||
    basename(name) !== name ||
    /[\\/]/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new Error("Package executable must be a package-root filename");
  return bundle ? join(packageRoot, "Contents/MacOS", name) : join(packageRoot, name);
}

export function context(name, opts = options()) {
  if (opts.help) {
    console.log(
      `Usage: node smoke/${name}.mjs --package-root PATH [--port NUMBER] [--keep-run-root]`,
    );
    if (name === "remote-control-e2e")
      console.log(
        "TURN: --connection-only --require-relay (--cloudflare-setup | --cloudflare-credentials PATH) [--turn-transport all|udp|tcp|tls] [--setup-timeout-seconds 600] [--timeout-seconds 90]",
      );
    process.exit(0);
  }
  const packageRoot = resolve(
    opts["package-root"] ?? process.env.OVULE_NATIVE_PACKAGE ?? join(projectRoot, "dist/ovule-dev"),
  );
  const executable = packageExecutable(packageRoot);
  const root = mkdtempSync(join(tmpdir(), `ovule-${name}-`));
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts);
  const env = { ...process.env, OVULE_DATA_DIR: join(root, "data"), OVULE_SMOKE_RUN_ROOT: root };
  const children = [];
  function start(command, args, label, extraEnv = {}, cwd = root) {
    const stdout = openSync(join(artifacts, `${label}.stdout.log`), "w");
    const stderr = openSync(join(artifacts, `${label}.stderr.log`), "w");
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...env, ...extraEnv },
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", stdout, stderr],
      });
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
    child.spawnError = null;
    child.on("error", (error) => {
      child.spawnError = error;
    });
    children.push(child);
    return child;
  }
  async function stop(child) {
    if (!child?.pid) return;
    if (process.platform === "win32") {
      if (child.exitCode === null)
        await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { capture: true }).catch(
          () => {},
        );
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (child.exitCode === null && child.signalCode === null)
      await Promise.race([
        new Promise((accept) => child.once("exit", accept)),
        sleep(5000, undefined, { ref: false }),
      ]);
  }
  async function assertPackageIdle() {
    if (!existsSync(executable))
      throw new Error(`Application executable is missing: ${executable}`);
    if (process.platform === "win32") {
      const pids = await windowsProbe("processes", packageRoot);
      if (pids.trim()) throw new Error(`Selected package is already running: ${pids.trim()}`);
    }
  }
  function launch(
    cdpPort,
    {
      label = "native",
      profile = "profile",
      extra = [],
      extraEnv = {},
      singleProcess = opts["single-process"],
    } = {},
  ) {
    if (!existsSync(executable))
      throw new Error(`Application executable is missing: ${executable}`);
    const args = [
      "--lang=en-US",
      "--force-renderer-accessibility=complete",
      `--user-data-dir=${join(root, profile)}`,
      `--log-file=${join(artifacts, `${label}.log`)}`,
      ...singleProcessArguments(singleProcess),
      ...extra,
    ];
    if (cdpPort !== null) args.push(`--remote-debugging-port=${cdpPort}`);
    return start(executable, args, label, extraEnv, packageRoot);
  }
  async function probe(file, extraEnv = {}) {
    return run(process.execPath, [join(smokeRoot, file)], { env: { ...env, ...extraEnv } });
  }
  async function cleanup(passed) {
    for (const child of children.toReversed()) await stop(child);
    // On Windows Chromium can outlive its launcher. Only an isolated package
    // that was checked idle before launch may use the package cleanup command.
    if (ownedPackage && process.platform === "win32") {
      await windowsProbe("stop", packageRoot);
      await windowsProbe("stop", root);
    }
    if (passed && !opts["keep-run-root"]) rmSync(root, { recursive: true, force: true });
    else console.log(`smoke_artifacts=${root}`);
  }
  let ownedPackage = false;
  async function claimPackage() {
    await assertPackageIdle();
    ownedPackage = true;
  }
  return {
    opts,
    root,
    artifacts,
    env,
    packageRoot,
    executable,
    children,
    start,
    stop,
    claimPackage,
    launch,
    probe,
    cleanup,
  };
}
export async function main(name, action) {
  const c = context(name);
  let passed = false;
  try {
    await action(c);
    passed = true;
    console.log(`${name.replaceAll("-", "_")}_runner=ok run_root=${c.root}`);
  } finally {
    await c.cleanup(passed);
  }
}
