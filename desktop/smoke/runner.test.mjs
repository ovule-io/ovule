import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  context,
  packageExecutable,
  options,
  port,
  availablePort,
  waitFor,
  waitHttp,
  smokeRoot,
  run,
} from "./runner.mjs";

test("runner options preserve paths with spaces and reject missing values", () => {
  assert.deepEqual(options(["--package-root", "C:\\Test App", "--stress", "--keep-run-root"]), {
    "package-root": "C:\\Test App",
    stress: true,
    "keep-run-root": true,
  });
  assert.throws(() => options(["--package-root", "--stress"]), /Missing value/);
  assert.throws(() => options(["-PackageRoot"]), /Unexpected argument/);
  assert.throws(() => port("not-a-port", 9237), /Invalid port/);
});

test("isolated runner cleans owned process and successful artifacts without mutating parent environment", async () => {
  const previous = process.env.OVULE_DATA_DIR;
  const c = context("runner-contract", { "package-root": "/unused" });
  const child = c.start(process.execPath, ["-e", "setInterval(() => {}, 1000)"], "child");
  await waitFor(() => Boolean(child.pid), "child start");
  assert.notEqual(c.env.OVULE_DATA_DIR, previous);
  assert.equal(process.env.OVULE_DATA_DIR, previous);
  await c.cleanup(true);
  assert(!existsSync(c.root));
  assert(child.exitCode !== null || child.signalCode !== null);
});

test("failed runs retain evidence", async () => {
  const c = context("failure-contract", { "package-root": "/unused" });
  writeFileSync(join(c.artifacts, "evidence.json"), "{}");
  await c.cleanup(false);
  assert(existsSync(join(c.artifacts, "evidence.json")));
  rmSync(c.root, { recursive: true });
});

test("static SPA server serves real assets, routes and extension assets on this platform", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "ovule-spa-contract-"));
  const client = join(fixture, "client"),
    extensions = join(fixture, "web");
  mkdirSync(client);
  mkdirSync(join(extensions, "extensions/test"), { recursive: true });
  writeFileSync(join(client, "index.html"), "<html>SPA</html>");
  writeFileSync(join(client, "app.js"), "export const test = true;");
  writeFileSync(join(extensions, "extensions/test/extension.json"), '{"id":"test"}');
  const c = context("spa-contract", { "package-root": fixture });
  try {
    const number = await availablePort(0);
    const child = c.start(
      process.execPath,
      [join(smokeRoot, "static-spa-server.mjs"), client, String(number), extensions],
      "server",
    );
    const url = `http://127.0.0.1:${number}`;
    await waitHttp(url, child);
    assert.equal(await (await fetch(`${url}/app.js`)).text(), "export const test = true;");
    assert.equal(await (await fetch(`${url}/main/deep-route`)).text(), "<html>SPA</html>");
    assert.deepEqual(await (await fetch(`${url}/extensions/test/extension.json`)).json(), {
      id: "test",
    });
  } finally {
    await c.cleanup(true);
    rmSync(fixture, { recursive: true });
  }
});

test("probe commands propagate failure", async () => {
  await assert.rejects(run(process.execPath, ["-e", "process.exit(7)"]), /failed \(7\)/);
});

test("package executables distinguish debug/release and reject escaping paths", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ovule-executable-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const executable of ["ovule.exe", "ovule-debug.exe"]) {
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ executable }));
    assert.equal(packageExecutable(root), join(root, executable));
  }
  for (const executable of [
    "../other.exe",
    "folder/other.exe",
    "folder\\other.exe",
    "..",
    "",
    null,
  ]) {
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ executable }));
    assert.throws(() => packageExecutable(root), /package-root filename/);
  }
});

test("macOS bundles resolve the executable from their Resources manifest", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ovule-app-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resources = join(root, "Contents/Resources");
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "manifest.json"), JSON.stringify({ executable: "ovule" }));
  assert.equal(packageExecutable(root), join(root, "Contents/MacOS/ovule"));
  writeFileSync(join(resources, "manifest.json"), JSON.stringify({ executable: "../escape" }));
  assert.throws(() => packageExecutable(root), /package-root filename/);
});
