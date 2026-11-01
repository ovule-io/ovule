import { rm, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectNotices, writeNotices } from "./third-party-notices.mjs";

type Target = "browser" | "node";
type Build = { group: string; entry: string; output: string; target: Target; isolated?: boolean };

const uiGroups = ["cloudflare-connectivity", "agent-codex", "agent-deepseek", "visuals"] as const;
const groups = [...uiGroups, "settings-ui"] as const;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = process.env.OVULE_EXTENSION_OUT_DIR
  ? path.resolve(process.env.OVULE_EXTENSION_OUT_DIR)
  : repoRoot;

function outputPath(relativePath: string): string {
  return path.join(outputRoot, relativePath);
}

const builds: Build[] = [
  {
    group: "settings-ui",
    entry: "features/settings/isolated/ollama.ts",
    output: "features/settings/dist/ollama-ui.js",
    target: "browser",
    isolated: true,
  },
  ...uiGroups.map(
    (group): Build => ({
      group,
      entry: `extensions/${group}/src/ui.ts`,
      output: `extensions/${group}/dist/ui.js`,
      target: "browser",
      isolated: true,
    }),
  ),
  agent("agent-codex"),
  agent("agent-deepseek"),
  {
    group: "visuals",
    entry: "extensions/visuals/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    output: "extensions/visuals/dist/web/pdf.worker.mjs",
    target: "browser",
  },
];

const requested = Bun.argv.slice(2);
const selected = requested.length ? requested : [...groups];
for (const group of selected) {
  if (!(groups as readonly string[]).includes(group)) {
    throw new Error(`unknown extension build group: ${group}`);
  }
  const groupOutputRoot =
    group === "settings-ui" ? "features/settings/dist" : `extensions/${group}/dist`;
  await rm(outputPath(groupOutputRoot), {
    recursive: true,
    force: true,
  });
}

let outputs = 0;
const notices = new Map();
for (const build of builds.filter((item) => selected.includes(item.group))) {
  const result = await Bun.build({
    entrypoints: [path.join(repoRoot, build.entry)],
    outdir: outputPath(path.dirname(build.output)),
    naming: {
      entry: path.basename(build.output),
      chunk: "chunks/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    target: build.target,
    format: "esm",
    splitting: Boolean(build.isolated),
    minify: true,
    metafile: true,
    // Resolve directories at runtime instead of embedding the developer's checkout.
    define: build.target === "node" ? { __dirname: "import.meta.dirname" } : undefined,
    plugins:
      build.group === "visuals"
        ? [
            {
              name: "office-source-inputs",
              setup(builder) {
                builder.onResolve({ filter: /\.css$/ }, (args) => ({
                  path: args.path,
                  external: true,
                }));
                // Use source modules so every dependency has a reviewable input/license.
                // The bare ExcelJS entry avoids polyfills unnecessary in modern Chromium.
                builder.onResolve({ filter: /^exceljs$/ }, (args) => ({
                  path: Bun.resolveSync("exceljs/lib/exceljs.bare.js", args.importer),
                }));
                builder.onResolve({ filter: /^jszip$/ }, (args) => ({
                  path: Bun.resolveSync("jszip/lib/index.js", args.importer),
                }));
                builder.onResolve({ filter: /^stream$/ }, () => ({
                  path: Bun.resolveSync(
                    "readable-stream/readable-browser.js",
                    Bun.resolveSync(
                      "exceljs/lib/exceljs.bare.js",
                      path.join(repoRoot, "extensions/visuals"),
                    ),
                  ),
                }));
                builder.onResolve({ filter: /^(?:node:)?buffer$/ }, () => ({
                  path: Bun.resolveSync("buffer/", path.join(repoRoot, "extensions/visuals")),
                }));
              },
            },
          ]
        : [],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`failed to build ${build.entry}`);
  }
  if (build.isolated && build.group === "visuals") {
    const directory = outputPath("extensions/visuals/dist/web");
    await mkdir(directory, { recursive: true });
    for (const file of ["blocks.css", "office-editor.css"])
      await copyFile(
        path.join(repoRoot, "extensions/visuals/src/web", file),
        path.join(directory, file),
      );
  }
  const packages = notices.get(build.group) ?? new Map();
  await collectNotices(result.metafile, packages);
  notices.set(build.group, packages);
  outputs += 1;
}

for (const group of selected) {
  if (group === "settings-ui") continue;
  const directory = `extensions/${group}`;
  await writeNotices(path.join(repoRoot, directory), notices.get(group) ?? new Map());
  if (outputRoot !== repoRoot) {
    await writeNotices(outputPath(directory), notices.get(group) ?? new Map());
  }
}

console.log(
  `extension_build=ok groups=${selected.join(",")} outputs=${outputs} root=${outputRoot}`,
);

function agent(group: string): Build {
  return {
    group,
    entry: `extensions/${group}/src/extension.ts`,
    output: `extensions/${group}/dist/extension.mjs`,
    target: "browser",
  };
}
