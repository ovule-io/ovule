import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function writeIfChanged(path, value) {
  let previous;
  try {
    previous = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous !== value) writeFileSync(path, value);
}

export function channelArguments(args, root) {
  if (!["dev", "build", "package"].includes(args[0])) return args;
  const explicit = args.findIndex(
    (arg) => arg === "--manifest" || arg.startsWith("--manifest="),
  );
  const inline = explicit >= 0 && args[explicit].startsWith("--manifest=");
  const manifest =
    explicit < 0
      ? "tuffite.json"
      : inline
        ? args[explicit].slice(11)
        : args[explicit + 1];
  if (!manifest || resolve(root, manifest) !== resolve(root, "tuffite.json"))
    return args;
  const debug = args[0] !== "package" && !args.includes("--release");
  if (!debug) return args;
  const config = JSON.parse(
    readFileSync(resolve(root, "tuffite.json"), "utf8"),
  );
  config.productName = "Ovule Debug";
  config.app.identifier = "io.ovule.desktop.debug";
  config.bundle.executable = "ovule-debug";
  const path = resolve(root, ".tuffite-debug.json");
  writeIfChanged(path, JSON.stringify(config, collectKeys(config), 2));
  const forwarded = [...args];
  if (explicit < 0) forwarded.push("--manifest", path);
  else if (inline) forwarded[explicit] = `--manifest=${path}`;
  else forwarded[explicit + 1] = path;
  return forwarded;
}

// Match serde_json's sorted object keys so build.rs and the CLI share one file.
function collectKeys(value) {
  const keys = new Set();
  JSON.stringify(value, (key, item) => {
    keys.add(key);
    return item;
  });
  return [...keys].sort();
}
