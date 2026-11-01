// Keep type checking on the same SDK source as Vite during local Framework work.
import ts from "typescript";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(desktop, process.argv[2] ?? "tsconfig.app.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = config.error
  ? { errors: [config.error], fileNames: [], options: {} }
  : ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath));
if (process.env.OVULE_TUFFITE_DIR) {
  parsed.options.paths = {
    ...parsed.options.paths,
    "tuffite/explorer": [
      resolve(desktop, "..", process.env.OVULE_TUFFITE_DIR, "packages/tuffite/explorer.d.ts"),
    ],
  };
}
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => desktop,
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
}
