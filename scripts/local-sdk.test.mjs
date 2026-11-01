import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWithLocalSdk } from "./local-sdk.mjs";

test("local SDK commands cache their lock and preserve the release lock on success and failure", (t) => {
  const project = mkdtempSync(join(tmpdir(), "ovule-local-sdk-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const sdk = join(project, "sdk");
  for (const crate of ["tuffite", "tuffite-ioc"]) {
    mkdirSync(join(sdk, "crates", crate), { recursive: true });
    writeFileSync(join(sdk, "crates", crate, "Cargo.toml"), "[package]\n");
  }
  const release = join(project, "Cargo.lock");
  writeFileSync(release, "published lock\n");
  const env = {
    ...process.env,
    OVULE_TUFFITE_DIR: sdk,
    CARGO_HOME: join(project, "unused-home"),
  };
  assert.equal(
    runWithLocalSdk(
      process.execPath,
      ["-e", `require('fs').writeFileSync('Cargo.lock','local lock');`],
      env,
      project,
    ),
    0,
  );
  assert.equal(readFileSync(release, "utf8"), "published lock\n");
  assert.equal(
    readFileSync(join(project, ".tmp-tuffite-sdk", "Cargo.lock"), "utf8"),
    "local lock",
  );
  assert.equal(
    runWithLocalSdk(
      process.execPath,
      [
        "-e",
        `if(require('fs').readFileSync('Cargo.lock','utf8')!=='local lock')process.exit(8);process.exit(7);`,
      ],
      env,
      project,
    ),
    7,
  );
  assert.equal(readFileSync(release, "utf8"), "published lock\n");
  assert.equal(
    existsSync(join(project, ".tmp-tuffite-sdk", "command.lock")),
    false,
  );
  assert.match(
    readFileSync(
      join(project, ".tmp-tuffite-sdk", "cargo-home", "config.toml"),
      "utf8",
    ),
    /tuffite-ioc =/,
  );
});
