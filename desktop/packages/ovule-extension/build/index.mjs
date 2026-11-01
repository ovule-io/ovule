import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { collectNotices, writeNotices } from "./notices.mjs";
import { fileURLToPath } from "node:url";

/** Build an independent extension package with exact dependency notices. Requires Bun. */
export async function buildExtension({ root = process.cwd(), targets }) {
  if (!globalThis.Bun) throw new Error("Extension builds require Bun");
  const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  root = path.resolve(root);
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  const notices = new Map();
  for (const { entry, output, target = "browser", format = "esm" } of targets) {
    if (!output.startsWith("dist/") || output.split("/").includes("..")) {
      throw new Error(`Extension output must be inside dist/: ${output}`);
    }
    await mkdir(path.dirname(path.join(root, output)), { recursive: true });
    const built = await Bun.build({
      entrypoints: [path.join(root, entry)],
      outdir: path.dirname(path.join(root, output)),
      naming: path.basename(output),
      target,
      format,
      minify: true,
      metafile: true,
      define:
        format === "iife"
          ? { "import.meta.url": "location.href" }
          : target === "node"
            ? { __dirname: "import.meta.dirname" }
            : undefined,
      plugins: [
        {
          name: "extension-sdk",
          setup(builder) {
            builder.onResolve({ filter: /^@ovule\/extension$/ }, () => ({
              path: path.join(sdkRoot, "runtime.mjs"),
            }));
          },
        },
      ],
    });
    if (!built.success) throw new AggregateError(built.logs, `Failed to build ${entry}`);
    await collectNotices(built.metafile, notices);
  }
  await writeNotices(root, notices, path.join(root, "LICENSE"));
}
