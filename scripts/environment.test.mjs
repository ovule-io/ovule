import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import test from "node:test";
import { applicationEnvironment } from "./environment.mjs";
import { checkCliRevision } from "./sdk-pins.mjs";

test("a matching package version cannot hide an old CLI commit", () => {
  const current = "b111235bcf82e06f23a5d154231290fed5680d32";
  assert.doesNotThrow(() =>
    checkCliRevision(`tuff 0.1.0 (${current})\n`, current, "pinned/tuff"),
  );
  for (const version of [
    "tuff 0.1.0",
    "tuff 0.1.0 (19fbb4dcb5ef02ceb0acdb87a207ea2b6d80cc98)",
  ])
    assert.throws(
      () => checkCliRevision(version, current, "old/tuff"),
      /Stale Tuffite CLI: old\/tuff/,
    );
});

test("native-only checkout selection survives without a local SDK override", (t) => {
  const distribution = mkdtempSync(join(tmpdir(), "ovule-framework-"));
  t.after(() => rmSync(distribution, { recursive: true, force: true }));
  const env = applicationEnvironment({
    TUFFITE_FRAMEWORK_DIR: "/native-checkout",
    TUFFITE_FRAMEWORK_DIST: distribution,
    TUFFITE_FRAMEWORK_DIST_AUTO_DOWNLOAD: "0",
  });
  assert.equal(env.TUFFITE_FRAMEWORK_DIR, "/native-checkout");
  assert.equal(env.OVULE_TUFFITE_DIR, undefined);
  assert.equal(env.TUFFITE_FRAMEWORK_DIST_AUTO_DOWNLOAD, "0");
  assert.equal(
    env.TUFFITE_FRAMEWORK_DIST,
    toNamespacedPath(realpathSync(distribution)),
  );
});

test("an explicit SDK checkout also selects its native Framework root", (t) => {
  const distribution = mkdtempSync(join(tmpdir(), "ovule-framework-"));
  t.after(() => rmSync(distribution, { recursive: true, force: true }));
  const env = applicationEnvironment({
    OVULE_TUFFITE_DIR: distribution,
    TUFFITE_FRAMEWORK_DIR: "/other-native-checkout",
    TUFFITE_FRAMEWORK_DIST: distribution,
  });
  assert.equal(env.TUFFITE_FRAMEWORK_DIR, distribution);
});
