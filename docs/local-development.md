# Local development

Use [CONTRIBUTING](../CONTRIBUTING.md) for formatting, Zed and code checks.
Run application commands from the repository root. A separate Chromium checkout
is needed only when changing the Framework itself.

## Setup and daily commands

Install Git and the native Rust build tools: Xcode Command Line Tools on macOS or
Visual Studio Build Tools with C++ support on Windows. Then install the pinned tools
and desktop dependencies:

```sh
mise trust
mise install
mise exec -- git lfs pull
mise run install
mise run doctor
mise run dev
```

`mise.toml` and `rust-toolchain.toml` own tool versions. Cargo, Mise and the desktop
package pin the same Tuffite SDK commit; verify it with `mise run sdk:check`.
Use the locked Bun workspace, not npm lockfiles. Python is used by checks,
maintenance and evaluation tasks; daily app launch uses Bun and the pinned CLI.

| Command | Result |
| --- | --- |
| `mise run dev` | Build native/frontend resources and launch with Vite HMR |
| `mise run prepare` | Prepare the development package without launching |
| `mise run build` | Build native and frontend resources |
| `mise run package-debug` | Standalone debug package under `dist/ovule-debug` |
| `mise run package` | Production package and native dependency notices |
| `mise run check` | Source gate, Rust and desktop checks/tests |
| `mise run dev-clean` | Clean a stale development package |
| `mise run dev-fresh` | Clean and restart development |

Close running copies before replacing their packages, especially on Windows.
After Rust, SDK or resource changes, rebuild the package used for native tests;
HMR alone does not replace the native runtime. Browser-only fixtures exercise mock
APIs and cannot validate native dialogs, SQLite, Explorer, processes or IPC.

## Framework selection

The shared release tag lives in `mise.toml` as
`TUFFITE_FRAMEWORK_DIST_RELEASE_TAG`. The CLI selects a Distribution before Cargo
runs; changing only `build.rs` cannot replace an already selected runtime.
The release's native ABI and SDK must agree with all three SDK/CLI pins.

An explicit `TUFFITE_FRAMEWORK_DIST` takes precedence over discovery/downloads.
Local checkout output and any present vendored artifact can also override the
published release. This repository currently tracks no `vendors/` Distribution;
Git LFS alone does not supply a missing platform artifact. Use `mise run doctor`
to inspect the actual path and target, rather than assuming a release tag was used.

Keep exact local paths in ignored `mise.local.toml`:

```toml
[env]
OVULE_TUFFITE_DIR = ""
OVULE_TUFF_CLI = ""
TUFFITE_FRAMEWORK_DIST = "/path/to/tuffite/dist/tuffite-framework-macos-x64"
TUFFITE_FRAMEWORK_DIST_AUTO_DOWNLOAD = "0"
```

Use the appropriate Windows/arm64 artifact. Do not edit ABI fields in its manifest
to bypass compatibility checks. The Framework manifest determines the Rust target.
On Apple Silicon, require an arm64 artifact with
`TUFFITE_FRAMEWORK_DIST_TARGET=aarch64-apple-darwin` when Rosetta fallback is unwanted.

### Local SDK changes

For SDK co-development, build the matching Framework Distribution in the Tuffite
checkout using its development instructions. Rebuild the CLI after SDK/ABI changes:

```sh
cargo build --locked --package tuffite --features cli --bin tuff
```

Select the same checkout, rebuilt CLI and native output in `mise.local.toml`:

```toml
[env]
OVULE_TUFFITE_DIR = "/path/to/tuffite"
OVULE_TUFF_CLI = "/path/to/tuffite/target/debug/tuff"
TUFFITE_FRAMEWORK_DIST = "/path/to/tuffite/dist/tuffite-framework-macos-x64"
TUFFITE_FRAMEWORK_DIST_AUTO_DOWNLOAD = "0"
```

Use `tuff.exe` on Windows. The project shim checks the CLI commit and applies the
same SDK selection to Cargo, TypeScript and Vite. Temporary Cargo patches preserve
the published lockfile and serialize local-SDK commands; their lock lives under
`.tmp-tuffite-sdk/`. Do not commit machine-specific Cargo patches. Clear both
`OVULE_TUFF*` settings to remove inherited terminal overrides.

When rolling published SDKs, update `Cargo.toml`, `mise.toml` and
`desktop/package.json` together, then refresh the CLI and lockfiles deliberately.
A stale app library/package does not become ABI-compatible when a pin changes.

## Debug and release side by side

Development uses **Ovule Debug**, app ID `io.ovule.desktop.debug`; production uses
`io.ovule.desktop`. Data, installed extensions, credentials and browser profiles
are separate. An explicit `OVULE_DATA_DIR` overrides this isolation, so use a
separate directory for each build. User-selected Workspace files remain shared.

| Platform | Debug data | Production data |
| --- | --- | --- |
| macOS | `~/Library/Application Support/io.Ovule.Ovule-Debug` | `~/Library/Application Support/io.Ovule.Ovule` |
| Windows | `%LOCALAPPDATA%/Ovule/Ovule Debug/data` | `%LOCALAPPDATA%/Ovule/Ovule/data` |

`mise run reset-data` targets Debug. `python scripts/reset_data.py --release`
explicitly targets production. These commands remove app state; use them only
when resetting that profile is intended.

macOS Screen Recording and Accessibility grants are also per build identity.
Launch the matching `.app`, authorize it in Settings, and restart the Host after
system permission changes. See [macOS permissions](macos-permissions.md).

### ShellAPI build channels

Debug and release have different command IDs. Builds generate clients in
`desktop/packages/ovule-shell-api/generated/debug/` and `generated/` respectively.
Vite selects Debug; frontend release builds select Release. Use
`OVULE_BUILD_CHANNEL` only for deliberate direct-command overrides.

A binding mismatch usually means frontend/native build channels disagree.
Dispatch status 2 is access denied, not proof of an ABI or transport failure.
Rebuild both sides for the same channel; do not bypass command checks. Generated
clients encode request structs, including no-argument requests; an empty raw
Mojom payload is invalid.

## Native smoke checks

Prepare a fresh package and pass its unpacked root to the relevant test. The
smoke tools normally use isolated app data; retain the printed run directory for
logs and diagnostics. Native permissions and real network/account operations must
be verified on the actual target platform.

```sh
# Native window/compositor suite; requires an interactive Windows desktop.
node desktop/smoke/native-ui.mjs --package-root dist/<candidate>
node desktop/smoke/remote-control-e2e.mjs --package-root dist/<candidate> --keep-run-root
node desktop/smoke/host-power.mjs --package-root dist/<candidate> --keep-run-root
python3 scripts/smoke_typed_mojom.py --package dist/<candidate>
```

The typed-Mojom check copies the package and checks typed Rust/C++ calls, binary
payloads, permissions, schema rejection, deny precedence and traversal, including
a restart. Browser fixture tests do not replace these native dispatch checks.
See the smoke script's `--help` for its current switches and platform constraints.

The local smoke skill under `.agents/skills/smoke-ovule-app/` provides a suite matrix
and isolated runner. Remote Control tests need actual decoded frames and input,
not merely a connected data channel. See [Remote Control](remote-control-architecture.md)
and [relay deployment](remote-control-relay-deployment.md).

## Harness evaluation

```sh
python3 scripts/harness_eval.py --repeat 3
python3 scripts/harness_eval.py --baseline artifacts/harness-eval/<run>/report.json
python3 scripts/harness_eval.py --suite native --package-root dist/<candidate>
python3 scripts/harness_eval.py --suite native --browser-placement workbench --package-root dist/<candidate>
bun run --cwd desktop smoke:control-feedback
```

The dataset in `evals/harness/cases.json` fixes case/grader IDs. Contract evaluation
exercises actual context services, SQLite restart, scope/CAS, route/planning/budget
and trace privacy. Native evaluation uses a scripted provider with real Explorer
and capture paths. Test overlay/sidebar/workbench/window placements serially and
check state preservation and subsequent tool calls, not only DOM presence.

Reports record dataset/source hashes, platform, case metrics, artifacts, p50/p95
and observed success-at-k/all-of-k. Skips fail the gate. Baselines must match the
dataset and adapter kind. Deterministic contracts and scripted providers do not
measure real-model task success, WAN performance or unsupported native permissions.
An external model adapter writes the versioned result schema to `OVULE_EVAL_OUTPUT`;
see `scripts/harness_eval.py` for validation and `--adapter` configuration.

## Diagnostics and recovery

The reply bug dialog's **Copy diagnostic bundle** includes message content, nearby
context, the correlated Attempt, model rounds and the durable tool journal. It
uses best-effort credential/URL redaction and does not read SecretStore or the
environment. Review it before sharing. Older Attempts cannot reconstruct missing
metrics. See [observability](observability.md) for persistence and privacy boundaries.

**Keep this Host awake** is local, opt-in and process-owned. It prevents idle system
sleep, not display sleep, lid closure, explicit sleep or loss of network. Quitting
or crashing releases the request; it does not install a background Host service.

After a macOS Keychain reset, preserve encrypted Link identity/access files.
Rotating identity invalidates existing pairings. To authenticate identities against
a trusted legacy Keychain without writing changes:

```sh
python3 scripts/recover_macos_link_credentials.py \
  --data-root "$HOME/Library/Application Support/io.Ovule.Ovule" \
  --legacy-keychain /path/to/original-login.keychain-db
```

The recovery tool requires macOS and Python `cryptography`. Use `--apply` only
after successful authentication and review; it backs up encrypted identities and
re-encrypts the same bytes without changing grants. It never prints keys. Debug
and release use different Keychain identities. Missing keys are recovery errors,
not permission to create replacement keys silently.

## Implementation references

- [Rust architecture](rust-architecture.md): IoC registration, eager startup,
  ownership and cancellation. Background work must not strongly retain its owner.
- [Agent execution permissions](agent-execution-permissions.md): scoped commands,
  sandbox limits and one-shot approval.
- [Agent harness](ovule-harness.md): Browser transfer, stale refs, memory and media.
- [Product UI](product-ui.md): Thread controls, approvals, downloads and previews.
