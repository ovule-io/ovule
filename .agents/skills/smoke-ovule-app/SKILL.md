---
name: smoke-ovule-app
description: Run and evolve Ovule's layered cross-platform application smoke workflow, including source checks, package integrity, Thread Explorer, Office/PDF, Browser Panel, Agent streaming, native CRD Computer Use, DevTools, restart persistence, and native desktop behavior. Use when validating a Ovule candidate or release package, reproducing a packaged-app regression, preparing release evidence, or extending smoke coverage after a feature or bug fix.
---

# Smoke Ovule App

Run validation in layers and keep the selected package immutable during a run. Treat every skip as evidence to report, never as a pass.

## Start here

1. Read [references/smoke-matrix.md](references/smoke-matrix.md) before changing coverage or running a release gate.
2. Inspect `git status` and preserve unrelated work.
3. Use a newly named candidate package. Do not overwrite `dist/ovule-production` before every required layer passes.
4. Run the reusable driver from the Ovule root:

```sh
python .agents/skills/smoke-ovule-app/scripts/run_smoke.py --package-root dist/<candidate> --suite full --source-checks --require-native
```

Use `--dry-run` to review commands, `--suite core` for package/CDP coverage without long desktop interaction suites, and `--keep-going` only when collecting multiple independent failures.
The native suite exercises the built-in CRD Computer Use facade directly. It
must not install or launch a separate desktop-control Toolchain.

## Prepare a candidate

Reuse an existing Tuffite Chromium output. Never configure or rebuild Chromium as part of this Skill unless the user explicitly requests it. For the standard adjacent checkout, snapshot `../src/out/TuffiteRelease` with `../x.py package --profile release --skip-build`, verify that distribution, build Ovule, and package to a fresh candidate name. Keep framework distribution output separate from application package output.

Run source checks before native smoke. Use `scripts/cargo.py` for Rust so the containing Tuffite Cargo configuration does not leak into the standalone workspace. The runner isolates compile-only UI and Extension output with `OVULE_UI_OUT_DIR` and `OVULE_EXTENSION_OUT_DIR`, so a running app cannot lock the source check's build destination.

## Interpret results

- `PASS` means the command ran and returned zero.
- `SKIP` means the current platform lacks an adapter or a layer was not requested. Include every skip in the handoff.
- `FAIL` means the candidate must not be promoted. Preserve the emitted run root/artifacts before rerunning.
- Run native suites serially. They own and terminate processes from the selected package.
- Do not use a normal product launch as a substitute for the CDP runner; the latter supplies isolated data, fake providers, and deterministic native CRD assertions.

## Extend the workflow

When fixing a packaged-app regression, add the narrowest deterministic assertion to an existing adapter when possible. Add a new adapter only when the lifecycle or platform requirements differ. Update the smoke matrix in the same change, run `quick_validate.py` on this Skill, and exercise the runner with at least `--dry-run` plus the affected real suite.

Keep secrets, user profiles, live provider accounts, and external production state out of smoke tests. Prefer isolated temp roots and deterministic fake services.
