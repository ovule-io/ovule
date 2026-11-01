// Resolve the selected SDK CLI and build channel. Workflow belongs in mise.toml.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applicationEnvironment, root, run } from "./environment.mjs";
import { runWithLocalSdk } from "./local-sdk.mjs";
import { checkCliRevision, checkSdkPins } from "./sdk-pins.mjs";
import { channelArguments } from "./build-channel.mjs";

try {
  const { cliTool, revision } = checkSdkPins(root);
  const env = applicationEnvironment();
  if (env.OVULE_TUFFITE_DIR && !env.OVULE_TUFF_CLI)
    throw new Error(
      "Local SDK development requires its matching OVULE_TUFF_CLI executable",
    );
  const executable = env.OVULE_TUFF_CLI
    ? resolve(root, env.OVULE_TUFF_CLI)
    : join(
        run("mise", ["where", cliTool], env, true).trim(),
        "bin",
        process.platform === "win32" ? "tuff.exe" : "tuff",
      );
  if (!existsSync(executable))
    throw new Error(
      `Pinned CLI executable is missing: ${executable}. Reinstall with mise install --force '${cliTool}'.`,
    );
  const expectedRevision = env.OVULE_TUFFITE_DIR
    ? run(
        "git",
        ["-C", resolve(root, env.OVULE_TUFFITE_DIR), "rev-parse", "HEAD"],
        env,
        true,
      ).trim()
    : revision;
  checkCliRevision(
    run(executable, ["--version"], env, true),
    expectedRevision,
    executable,
  );
  const args = channelArguments(process.argv.slice(2), root);
  if (["dev", "build", "package"].includes(args[0]))
    env.OVULE_BUILD_CHANNEL = args.some((arg) =>
      arg.includes(".tuffite-debug.json"),
    )
      ? "debug"
      : "release";
  if (env.OVULE_TUFFITE_DIR)
    process.exitCode = runWithLocalSdk(executable, args, env);
  else run(executable, args, env);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
