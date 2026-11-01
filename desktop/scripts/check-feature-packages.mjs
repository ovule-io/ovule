import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { validateManifest } from "./feature-manifest.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
for (const entry of await readdir(path.join(root, "features"), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const packageRoot = path.join(root, "features", entry.name);
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  errors.push(...validateManifest(manifest, { packageRoot }));
}
const config = ts.readConfigFile(path.join(root, "tsconfig.features.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: { ...parsed.options, skipLibCheck: false },
});
for (const file of program.getSourceFiles()) {
  if (!file.fileName.startsWith(path.join(root, "features")) || !file.isDeclarationFile) continue;
  for (const d of [
    ...program.getSyntacticDiagnostics(file),
    ...program.getSemanticDiagnostics(file),
  ])
    errors.push(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log("feature-packages=ok");
