import { applicationEnvironment, run } from "./environment.mjs";
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--release"))
  throw new Error("Usage: frontend.mjs [--release]");
run("bun", ["run", "--cwd", "desktop", "build"], {
  ...applicationEnvironment(),
  OVULE_BUILD_CHANNEL: args.includes("--release") ? "release" : "debug",
});
