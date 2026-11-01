import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { channelArguments } from "./build-channel.mjs";
import { shellApiChannel } from "../desktop/scripts/shell-api-channel.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ovule-channel-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = readFileSync(
    new URL("../tuffite.json", import.meta.url),
    "utf8",
  );
  writeFileSync(join(root, "tuffite.json"), source);
  return { root, source };
}

test("debug commands derive isolated metadata without changing assets, security or the release manifest", (t) => {
  const { root, source } = fixture(t);
  for (const command of ["dev", "build"]) {
    const args = channelArguments(
      [command, "--manifest", "tuffite.json"],
      root,
    );
    assert.equal(args[2], join(root, ".tuffite-debug.json"));
    const manifest = JSON.parse(readFileSync(args[2], "utf8"));
    const expected = JSON.parse(source);
    expected.productName = "Ovule Debug";
    expected.app.identifier = "io.ovule.desktop.debug";
    expected.bundle.executable = "ovule-debug";
    assert.deepEqual(manifest, expected);
    assert.equal(readFileSync(join(root, "tuffite.json"), "utf8"), source);
  }
  const path = join(root, ".tuffite-debug.json");
  const modified = statSync(path).mtimeMs;
  channelArguments(["dev"], root);
  assert.equal(
    statSync(path).mtimeMs,
    modified,
    "unchanged manifests must not invalidate Cargo",
  );
});

test("release and unrelated/custom manifest commands preserve their arguments", (t) => {
  const { root } = fixture(t);
  for (const args of [
    ["build", "--release"],
    ["dev", "--release"],
    ["package"],
    ["doctor"],
    ["build", "--manifest", "custom.json"],
    ["build", "--manifest=custom.json"],
  ])
    assert.deepEqual(channelArguments(args, root), args);
  assert.equal(existsSync(join(root, ".tuffite-debug.json")), false);
  assert.deepEqual(channelArguments(["dev", "--prepare-only"], root), [
    "dev",
    "--prepare-only",
    "--manifest",
    join(root, ".tuffite-debug.json"),
  ]);
  assert.deepEqual(
    channelArguments(["build", "--manifest=tuffite.json"], root),
    ["build", `--manifest=${join(root, ".tuffite-debug.json")}`],
  );
});

test("Vite selects separate Debug and Release clients for direct imports and served bindings", () => {
  assert.match(
    shellApiChannel("serve", {}).bindings,
    /generated\/debug\/index.js$/,
  );
  assert.match(shellApiChannel("build", {}).bindings, /generated\/index.js$/);
  assert.equal(
    shellApiChannel("build", { OVULE_BUILD_CHANNEL: "debug" }).bindings,
    shellApiChannel("serve", {}).bindings,
  );
  assert.equal(
    shellApiChannel("serve", { OVULE_BUILD_CHANNEL: "release" }).bindings,
    shellApiChannel("build", {}).bindings,
  );
  assert.throws(
    () => shellApiChannel("build", { OVULE_BUILD_CHANNEL: "other" }),
    /Invalid OVULE_BUILD_CHANNEL/,
  );
});
