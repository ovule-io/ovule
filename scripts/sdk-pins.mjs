import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkCliRevision(version, revision, executable) {
  const actual = version.match(/^tuff \S+ \(([0-9a-f]{40})\)\s*$/)?.[1];
  if (actual !== revision)
    throw new Error(
      `Stale Tuffite CLI: ${executable} reports ${version.trim()}, expected commit ${revision}. Clear OVULE_TUFF_CLI/OVULE_TUFFITE_DIR to use the pinned CLI, or rebuild the CLI from the selected local SDK checkout.`,
    );
}

export function checkSdkPins(root) {
  const sdk = Bun.TOML.parse(readFileSync(join(root, "Cargo.toml"), "utf8"))
    .workspace.dependencies.tuffite;
  const cli = Bun.TOML.parse(readFileSync(join(root, "mise.toml"), "utf8"))
    .tools[`cargo:${sdk.git}`];
  const js = JSON.parse(
    readFileSync(join(root, "desktop/package.json"), "utf8"),
  ).dependencies.tuffite;
  if (
    !/^[0-9a-f]{40}$/.test(sdk.rev) ||
    cli?.version !== `rev:${sdk.rev}` ||
    cli.crate !== "tuffite" ||
    cli.bin !== "tuff" ||
    js !== `git+${sdk.git}#${sdk.rev}`
  )
    throw new Error(
      "CLI, Rust SDK, and JS SDK must pin the same full Git commit in mise.toml, Cargo.toml, and desktop/package.json",
    );
  return { revision: sdk.rev, cliTool: `cargo:${sdk.git}` };
}

if (import.meta.main) {
  try {
    checkSdkPins(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    console.log("CLI, Rust SDK, and JS SDK pins match");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
