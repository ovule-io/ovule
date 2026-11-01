import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, toNamespacedPath } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function applicationEnvironment(environment = process.env) {
  const env = {
    ...environment,
    CARGO_TARGET_DIR: environment.CARGO_TARGET_DIR || join(root, "target"),
  };
  if (env.OVULE_TUFFITE_DIR)
    env.TUFFITE_FRAMEWORK_DIR = resolve(root, env.OVULE_TUFFITE_DIR);
  const platform =
    process.platform === "win32"
      ? "windows-x64"
      : process.platform === "darwin"
        ? `macos-${process.arch === "arm64" ? "arm64" : "x86_64"}`
        : null;
  if (!env.TUFFITE_FRAMEWORK_DIST && platform) {
    const local =
      env.TUFFITE_FRAMEWORK_DIR &&
      join(
        env.TUFFITE_FRAMEWORK_DIR,
        "dist",
        `tuffite-framework-${platform.replace("x86_64", "x64")}`,
      );
    const vendor = join(root, "vendors/tuffite-framework", platform);
    if (
      !(local && existsSync(join(local, "tuffite-framework.json"))) &&
      existsSync(join(vendor, "tuffite-framework.json"))
    )
      env.TUFFITE_FRAMEWORK_DIST = vendor;
  }
  if (env.TUFFITE_FRAMEWORK_DIST)
    env.TUFFITE_FRAMEWORK_DIST = toNamespacedPath(
      realpathSync(resolve(root, env.TUFFITE_FRAMEWORK_DIST)),
    );
  return env;
}

export function run(command, args, env, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} exited with ${result.status}${capture ? `\n${result.stderr}` : ""}`,
    );
  return result.stdout;
}
