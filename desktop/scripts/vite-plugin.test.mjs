import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadTuffiteVite } from "./tuffite-sdk.mjs";

const { tuffite, contentTypeForPath, decodeRequestPath, resolveConfinedFile } =
  await loadTuffiteVite();

const previousDirectory = process.cwd();
process.chdir(path.resolve(import.meta.dirname, "../.."));
const plugin = tuffite({
  shellApi: {
    url: "/shell_api.js",
    file: "desktop/packages/ovule-shell-api/generated/index.js",
  },
});
process.chdir(previousDirectory);
plugin.buildStart();
const id = plugin.resolveId("/shell_api.js");
assert.equal(typeof id, "string");
assert.match(await plugin.load(id), /export const mojomMethods/);
const frameworkId = plugin.resolveId("/tuffite.js");
assert.equal(typeof frameworkId, "string");
assert.match(await plugin.load(frameworkId), /createTuffiteApi/);
let emittedShellApi;
await plugin.generateBundle.call({
  emitFile(asset) {
    emittedShellApi = asset;
  },
});
assert.equal(emittedShellApi.fileName, "shell_api.js");
assert.match(emittedShellApi.source, /export const mojomMethods/);

assert.equal(decodeRequestPath("/preview/%E0%A4%A"), undefined);
assert.equal(contentTypeForPath("extension.mjs"), "text/javascript; charset=utf-8");
assert.equal(contentTypeForPath("theme.css"), "text/css; charset=utf-8");

const temporary = await mkdtemp(path.join(os.tmpdir(), "tuffite-vite-test-"));
try {
  const missing = tuffite({
    root: temporary,
    shellApi: { url: "/shell_api.js", file: "missing/shell_api.js" },
  });
  assert.throws(() => missing.buildStart(), /Build the application with Cargo first/);
  const root = path.join(temporary, "root");
  const outside = path.join(temporary, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.txt"), "secret");
  const link = path.join(root, "escape");
  await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(await resolveConfinedFile(root, path.join(link, "secret.txt")), undefined);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

console.log("vite_plugin_contract=ok");
