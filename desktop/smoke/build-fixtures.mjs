import path from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
import { buildExtension } from "../packages/ovule-extension/build/index.mjs";
import { smokeRoot, projectRoot } from "./runner.mjs";
for (const name of ["agent-sample", "channel-sample"]) {
  const root = path.join(smokeRoot, "fixtures", name);
  await buildExtension({
    root,
    targets: [{ entry: "src/extension.mjs", output: "dist/extension.mjs" }],
  });
  if (name === "channel-sample") {
    await mkdir(path.join(root, "dist/host"), { recursive: true });
    await copyFile(path.join(root, "src/worker.mjs"), path.join(root, "dist/host/worker.mjs"));
  }
  // Rust tests use the same public fixtures, without requiring a private checkout.
  const target = path.join(projectRoot, "tests/fixtures/plugins", name);
  await mkdir(path.join(target, "dist"), { recursive: true });
  await copyFile(path.join(root, "dist/extension.mjs"), path.join(target, "dist/extension.mjs"));
}
