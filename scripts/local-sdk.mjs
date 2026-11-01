// Explicit local SDK overlay. Release manifests and Cargo.lock remain intact.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { root } from "./environment.mjs";

export function runWithLocalSdk(
  command,
  args,
  environment = process.env,
  project = root,
) {
  if (!environment.OVULE_TUFFITE_DIR)
    throw new Error("OVULE_TUFFITE_DIR is required for a local SDK overlay");
  const sdk = resolve(project, environment.OVULE_TUFFITE_DIR);
  for (const crate of ["tuffite", "tuffite-ioc"])
    if (!existsSync(join(sdk, "crates", crate, "Cargo.toml")))
      throw new Error(`Missing local SDK crate: ${sdk}/crates/${crate}`);
  const cache = join(project, ".tmp-tuffite-sdk");
  mkdirSync(cache, { recursive: true });
  const marker = join(cache, "command.lock");
  let lock;
  try {
    lock = openSync(marker, "wx");
  } catch {
    throw new Error(
      `A local SDK command is already active; interrupted runs may require removing ${marker}`,
    );
  }
  const releaseLock = join(project, "Cargo.lock");
  const localLock = join(cache, "Cargo.lock");
  const previous = existsSync(releaseLock)
    ? readFileSync(releaseLock)
    : undefined;
  let started = false;
  try {
    const originalHome = environment.CARGO_HOME || join(homedir(), ".cargo");
    const cargoHome = join(cache, "cargo-home");
    mkdirSync(cargoHome, { recursive: true });
    for (const directory of ["registry", "git"]) {
      const target = join(cargoHome, directory);
      const source = join(originalHome, directory);
      if (existsSync(source) && !existsSync(target))
        symlinkSync(
          source,
          target,
          process.platform === "win32" ? "junction" : "dir",
        );
    }
    const globalConfig = join(originalHome, "config.toml");
    const sdkConfig = join(sdk, ".cargo", "config.toml");
    let config = existsSync(globalConfig)
      ? readFileSync(globalConfig, "utf8")
      : "";
    if (!config && existsSync(sdkConfig)) {
      // Adopt registry preferences, never SDK aliases or source patches.
      let keep = false;
      config = readFileSync(sdkConfig, "utf8")
        .split("\n")
        .filter((line) => {
          if (line.trim().startsWith("["))
            keep = /^\[(source\.|registries\.|net\])/.test(line.trim());
          return keep;
        })
        .join("\n");
    }
    config += `\n[patch."https://github.com/tuffite/tuffite.git"]\n`;
    for (const crate of ["tuffite", "tuffite-ioc"])
      config += `${crate} = { path = ${JSON.stringify(join(sdk, "crates", crate).replaceAll("\\", "/"))} }\n`;
    writeFileSync(join(cargoHome, "config.toml"), config);
    if (existsSync(localLock))
      writeFileSync(releaseLock, readFileSync(localLock));
    started = true;
    const result = spawnSync(command, args, {
      cwd: project,
      env: {
        ...environment,
        TUFFITE_FRAMEWORK_DIR: sdk,
        CARGO_HOME: cargoHome,
      },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    if (started && existsSync(releaseLock))
      writeFileSync(localLock, readFileSync(releaseLock));
    if (previous) writeFileSync(releaseLock, previous);
    else if (existsSync(releaseLock)) unlinkSync(releaseLock);
    closeSync(lock);
    unlinkSync(marker);
  }
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  try {
    process.exitCode = runWithLocalSdk(args.shift(), args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
