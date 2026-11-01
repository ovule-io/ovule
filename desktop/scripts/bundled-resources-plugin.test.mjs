import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  browserResourceForRequest,
  bundledResources,
  stageBundledResources,
} from "./bundled-resources-plugin.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ovule-bundled-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "extensions/editor/extension.json": JSON.stringify({
      runtime: { entry: "dist/extension.mjs" },
      contributes: {
        fileEditors: [{ module: "dist/web/editor.mjs", style: "dist/web/editor.css" }],
      },
    }),
    "extensions/editor/dist/extension.mjs": "host runtime",
    "extensions/editor/dist/host/helper.exe": "native executable bytes",
    "extensions/editor/dist/web/editor.mjs": "browser module bytes",
    "extensions/editor/dist/web/editor.css": "browser css",
    "extensions/editor/dist/web/worker.mjs": "browser worker",
    "extensions/editor/NOTICE.md": "license",
    "extensions/editor/src/editor.ts": "development source",
    "extensions/editor/node_modules/unused/index.js": "dependency source",
    "plugins/agent/extension.json": JSON.stringify({ runtime: { entry: "dist/extension.mjs" } }),
    "plugins/agent/dist/extension.mjs": "optional plugin",
    "plugins/agent/skills/plugin/SKILL.md": "plugin skill",
    "plugins/agent/workflows/setup.md": "workflow",
    "skills/onboarding/SKILL.md": "bundled skill",
    "skills/onboarding/scripts/setup.sh": "#!/bin/sh\n",
    "toolchains/registry.json": '{"schemaVersion":1}',
  };
  for (const [relative, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), contents);
  }
  await chmod(path.join(root, "extensions/editor/dist/host/helper.exe"), 0o755);
  return root;
}

test("stages browser and native runtime files without changing bytes or executable modes", async (t) => {
  const root = await fixture(t);
  const output = path.join(root, "dist/resources");
  const files = await stageBundledResources(root, output);
  assert.equal(
    await readFile(path.join(output, "extensions/editor/dist/host/helper.exe"), "utf8"),
    "native executable bytes",
  );
  assert.equal(
    (await lstat(path.join(output, "extensions/editor/dist/host/helper.exe"))).mode & 0o777,
    (await lstat(path.join(root, "extensions/editor/dist/host/helper.exe"))).mode & 0o777,
  );
  assert.equal(
    await readFile(path.join(output, "web/extensions/editor/dist/web/worker.mjs"), "utf8"),
    "browser worker",
  );
  assert.equal(
    await readFile(path.join(output, "skills/onboarding/SKILL.md"), "utf8"),
    "bundled skill",
  );
  await assert.rejects(lstat(path.join(output, "plugins")), { code: "ENOENT" });
  assert.ok(
    files.every(
      (file) => !file.relative.includes("/src/") && !file.relative.includes("node_modules"),
    ),
  );
  await assert.rejects(lstat(path.join(output, "web/extensions/editor/dist/host/helper.exe")), {
    code: "ENOENT",
  });
  await rm(path.join(root, "extensions/editor/dist/web/worker.mjs"));
  await stageBundledResources(root, output);
  await assert.rejects(lstat(path.join(output, "web/extensions/editor/dist/web/worker.mjs")), {
    code: "ENOENT",
  });
});

test("keeps extension browser URLs and rejects native paths, traversal, malformed URLs and symlinks", async (t) => {
  const root = await fixture(t);
  assert.equal(
    await browserResourceForRequest(root, "/extensions/editor/dist/web/editor.mjs?version=1"),
    path.join(root, "extensions/editor/dist/web/editor.mjs"),
  );
  for (const url of [
    "/extensions/editor/dist/host/helper.exe",
    "/plugins/agent/dist/extension.mjs",
    "/extensions/editor/dist/web/%2e%2e%2fextension.mjs",
    "/extensions/editor/dist/web/%E0%A4%A",
    "/extensions/editor/dist/web/missing.mjs",
  ]) {
    assert.equal(await browserResourceForRequest(root, url), undefined);
  }
  await symlink(
    path.join(root, "toolchains/registry.json"),
    path.join(root, "extensions/editor/dist/web/link.json"),
  );
  assert.equal(
    await browserResourceForRequest(root, "/extensions/editor/dist/web/link.json"),
    undefined,
  );
  await assert.rejects(
    stageBundledResources(root, path.join(root, "output")),
    /cannot be a symlink/,
  );
});

test("fails build when manifest runtime files are missing", async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, "extensions/editor/dist/extension.mjs"));
  await assert.rejects(stageBundledResources(root, path.join(root, "output")), { code: "ENOENT" });
});

test("ignores removed extension workspaces with leftover dependencies or builds", async (t) => {
  const root = await fixture(t);
  const staleRoot = path.join(root, "extensions/office");
  await mkdir(path.join(staleRoot, "node_modules"), { recursive: true });
  await mkdir(path.join(staleRoot, "dist"));
  await writeFile(path.join(staleRoot, "dist/stale.js"), "removed extension");
  const output = path.join(root, "output");
  const files = await stageBundledResources(root, output);
  assert.ok(files.some((file) => file.relative === "extensions/editor/extension.json"));
  assert.ok(files.every((file) => !file.relative.startsWith("extensions/office/")));
  await assert.rejects(lstat(path.join(output, "extensions/office")), { code: "ENOENT" });
});

test("rejects malformed extension manifests", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "extensions/editor/extension.json"), "{invalid");
  await assert.rejects(stageBundledResources(root, path.join(root, "output")), SyntaxError);
});

test("stages only the Vite client output, leaving server builds untouched", async (t) => {
  const root = await fixture(t);
  const plugin = bundledResources();
  plugin.configResolved({ root, build: { outDir: "dist/server", ssr: true } });
  await plugin.writeBundle({});
  await assert.rejects(lstat(path.join(root, "dist/server/bundled")), { code: "ENOENT" });
  plugin.configResolved({ root, build: { outDir: "dist/client", ssr: false } });
  await plugin.writeBundle({});
  assert.ok(
    (await lstat(path.join(root, "dist/resources/extensions/editor/extension.json"))).isFile(),
  );
});

test("Vite copies native resources as files and preserves extension module URLs", async (t) => {
  const root = await fixture(t);
  await writeFile(
    path.join(root, "index.html"),
    '<html><body><script type="module">console.log("app")</script></body></html>',
  );
  const { build } = await import("vite");
  await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [bundledResources()],
    build: { outDir: ".react-router/integration/client" },
  });
  const output = path.join(root, ".react-router/integration/resources");
  assert.equal(
    await readFile(path.join(output, "web/extensions/editor/dist/web/editor.mjs"), "utf8"),
    "browser module bytes",
  );
  assert.equal(
    await readFile(path.join(output, "extensions/editor/dist/host/helper.exe"), "utf8"),
    "native executable bytes",
  );
});

test("direct Vite development startup stages disk resources before serving", async (t) => {
  const root = await fixture(t);
  let middleware;
  const plugin = bundledResources();
  await plugin.configureServer({
    config: { root },
    middlewares: {
      use(handler) {
        middleware = handler;
      },
    },
  });
  assert.equal(typeof middleware, "function");
  await assert.rejects(lstat(path.join(root, "dist/resources/plugins")), { code: "ENOENT" });
});

test("uses the actual React Router client output and skips server environments", async (t) => {
  const root = await fixture(t);
  const plugin = bundledResources();
  plugin.configResolved({
    root,
    build: { outDir: "dist", ssr: false },
    environments: { client: { build: { outDir: ".react-router/custom/client" } } },
  });
  await plugin.writeBundle.call(
    { environment: { name: "ssr" } },
    { dir: path.join(root, ".react-router/custom/server") },
  );
  await assert.rejects(lstat(path.join(root, ".react-router/custom/server/bundled")), {
    code: "ENOENT",
  });
  await plugin.writeBundle.call(
    { environment: { name: "client" } },
    { dir: path.join(root, ".react-router/custom/client") },
  );
  assert.ok(
    (
      await lstat(
        path.join(root, ".react-router/custom/resources/extensions/editor/extension.json"),
      )
    ).isFile(),
  );
  await assert.rejects(lstat(path.join(root, "dist/bundled")), { code: "ENOENT" });
});

test("creates the manifest browser mount even without extension browser files", async (t) => {
  const root = await fixture(t);
  await rm(path.join(root, "extensions/editor"), { recursive: true });
  const output = path.join(root, "output");
  await stageBundledResources(root, output);
  assert.ok((await lstat(path.join(output, "web/extensions"))).isDirectory());
});
