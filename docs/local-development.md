# Local development

Browser origin settings now live in top-level `browser.rules`, including ShellAPI
grants, Explorer creation/scripts, document CSP and Explorer behavior defaults.
Internal protocols are explicitly declared in `app.schemes` (Ovule uses
`["ovule"]`). Window URLs, asset origins and browser rules do not register extra
schemes implicitly. Internal schemes are distinct from operating-system deep links.
Defaults match the Explorer owner's committed origin; embedded pages retain their
own document grants and CSP. Elements use declarations such as
`behavior="navigation: delegate; dialog: delegate; external-protocol: browser;"`.
The old `app.security.capabilities`, global `app.security.csp`, `navigation` and
`dialogs` element attributes are removed. Local Framework and CLI sources must
both include this manifest revision; published SDK pins remain unchanged until
the corresponding Framework release is available.

`browser.devtools` controls both the built-in inspector and CDP (default `true`).
Origin denials use `browser.rules[].devtools`; specifying a debugging port cannot
override the master switch. Utility startup data is configured in Rust setup,
not through `app.utilities`.

Run these commands from the Ovule repository root:

```sh
mise trust
mise install
mise exec -- git lfs pull
mise run dev
```

Mise pins Bun `1.4.2`, Node `22.22.0`, Rust `1.91.0`, and Git LFS `3.6.1`.
Git LFS materializes the vendored native binaries after cloning. Do not create an npm
lockfile. The daily application workflow does not require Python. Native app
development requires a matching published Tuffite Distribution or compatible
local release output. Framework development retains its existing Python tasks.

Use `mise run prepare`, `mise run build`, `mise run package`, or `mise run doctor`.
All development workflow ordering and package arguments live in `mise.toml`.
`scripts/tuff.mjs` only resolves the pinned executable, sets the application
environment, selects the build channel, and forwards CLI arguments; it never
starts other tasks.
`mise run notices` independently generates native dependency notices.
Rust dependency notices are generated during `package`, not ordinary
`dev`, `prepare`, or `build` runs. Update them after dependency changes when
preparing a distributable package.
Use `mise run build --release -v` for a production Rust/frontend build, or
`mise run native -- <arguments>` for direct native build options.
With the tools already on PATH, use `bun run dev`, `bun run dev:prepare`,
`bun run build`, `bun run package`, or `bun run doctor`. The Bun runner locates
the Git SDK revision pinned in `Cargo.toml` through Cargo's cache and invokes
the matching `tuff` CLI installed by Mise. The JavaScript SDK is a `git+https`
dependency at the same commit. The runner rejects differing pins in `Cargo.toml`,
`mise.toml`, and `desktop/package.json`. Update all three together, then run
`mise install` and `mise exec -- bun install --cwd desktop` to refresh lockfiles.
`mise run tuff -- <arguments>` uses that same CLI. Mise prepends the project's
`scripts/bin` shim, so direct `tuff` calls also use this resolver instead of an
older executable in `~/.cargo/bin`. The resolver checks the CLI build commit
before executing it; a matching `0.1.0` package version alone is insufficient.
Custom paths belong in ignored `mise.local.toml`. Python scripts remain available
for maintenance checks and compatibility with existing workflows.

## Debug and release side by side

`mise run dev`, `mise run prepare`, and builds without `--release` use
**Ovule Debug** (`io.ovule.desktop.debug`, executable `ovule-debug`).
`mise run package-debug` creates a standalone debug package in `dist/ovule-debug`
without an HMR server. `mise run package` and builds with `--release` use the
production identity.
The CLI derives an ignored `.tuffite-debug.json` from `tuffite.json`; edit the
source manifest rather than the generated file. Direct Cargo builds select the
same identity for ShellAPI generation through `build.rs`.

System Screen Recording and Accessibility grants are also separate. Settings → General
and the local Hosts panel display live status for the running bundle. Use **Authorize**
to request access, or **Manage** to open the corresponding macOS privacy pane. Fully
quit and reopen that Host app after changing grants. The current process Bundle ID
must match the selected build channel before a request is allowed. Grants are never
inferred from the data directory, pairing, Cloudflare authorization or Keep this Host
awake, and are never copied between debug and release. An unbundled executable must
be launched from its matching `.app` to manage permissions.

Both apps can run together. Debug uses separate application data, installed
extensions, credentials, and Framework browser data/cache. On Windows, application
state lives in `%LOCALAPPDATA%/Ovule/Ovule Debug/data`; release retains
`%LOCALAPPDATA%/Ovule/Ovule/data`. On macOS, the corresponding directories are
`~/Library/Application Support/io.Ovule.Ovule-Debug` and
`~/Library/Application Support/io.Ovule.Ovule`. Debug starts with fresh onboarding;
existing production data is neither moved nor copied. An explicit `OVULE_DATA_DIR`
still overrides the application state path, so use different overrides to retain
isolation. User-selected workspace files are shared if both apps open the same folder.

Tuffite's build script watches generated ShellAPI outputs, so switching profiles
regenerates matching bindings. Finish one build before starting another profile's
build. Packaged release resources remain independent of subsequent development builds.
`mise run reset-data` targets debug state by default; use
`python scripts/reset_data.py --release` explicitly for production state.

Build-channel isolation does not change the Ovule Link protocol. Either app can
share a Host/Workspace with the other: import its Link, enter the approval code
shown by the receiving Host, and explicitly grant the Workspace. Local settings,
projects, and conversation databases remain independent; shared Workspace files
are read and written through the authenticated remote binding. Removing a grant
blocks existing bindings immediately; restoring it makes the same binding usable.

## Published Framework release

The shared release pin is `TUFFITE_FRAMEWORK_DIST_RELEASE_TAG = "v0.1.1"`
in the committed `mise.toml` `[env]` section. Change that one value, then run
`mise run doctor` and `mise run prepare` (or `mise run package`). No per-command
export or cache deletion is needed: managed downloads are namespaced by release.
Use the exact GitHub tag, including `v`.

Do not pin the native release only in `build.rs`: `tuff` selects the runtime
before it invokes Cargo and passes its selected `TUFFITE_FRAMEWORK_DIST` to the
build script. The build script therefore cannot change that already-selected
runtime. Ovule's build script now uses the shared environment selection.

Explicit `TUFFITE_FRAMEWORK_DIST`, local `TUFFITE_FRAMEWORK_DIR` output, and
vendored artifacts still take precedence over downloads. If doctor reports a
local path, changing the release tag does not replace that artifact. Clear the
local path overrides in `mise.local.toml` and move aside a stale vendored
Distribution when intentionally testing a published download. The release tag
selects a GitHub asset; its SDK version and ABI must still be compatible with
the pinned Rust/JS SDK and CLI.

## Local Framework selection

A GitHub Release is not required to validate a new ABI locally. Keep the CLI,
Rust SDK and JavaScript SDK pinned to the same Git commit in `mise.toml`,
`Cargo.toml` and `desktop/package.json`; run `mise run sdk:check` after changing
these pins. Refresh the installed CLI and dependency locks with `mise install`,
`mise exec -- cargo metadata --format-version 1`, and
`mise exec -- bun install --cwd desktop`.

Build/package the matching native output in the Tuffite checkout once:

```sh
mise exec -- python3 x.py package --profile release --target-cpu x64
```

Choose the CPU for the actual app target. Native output is separate from the
Rust SDK/CLI; installing or building those Rust packages does not build Chromium.

Point Ovule at that Distribution in ignored `mise.local.toml`:

```toml
[env]
# Clear source overrides that an already-open terminal may still export.
OVULE_TUFFITE_DIR = ""
OVULE_TUFF_CLI = ""
TUFFITE_FRAMEWORK_DIST = "/path/to/tuffite/dist/tuffite-framework-macos-x64"
TUFFITE_FRAMEWORK_DIST_AUTO_DOWNLOAD = "0"
```

Use the corresponding Windows/arm64 path when applicable. The explicit path
wins over vendor/cache/download resolution, and an incompatible or missing
artifact fails instead of falling back to an older GitHub Release. Do not edit
ABI fields in the Distribution manifest: its native binaries must match the SDK.
`TUFFITE_FRAMEWORK_DIR` may instead point at a checkout for automatic release
Distribution discovery; `TUFFITE_FRAMEWORK_DIST` selects one exact artifact.

From Ovule, run `mise run doctor` to verify the selected Distribution and
`mise run dev` to build Rust/frontend resources and launch with HMR. For a
separate validation package without opening a window:

```sh
mise run tuff -- dev --package dist/ovule-abi-check --prepare-only
```

The next launch refreshes the app library and copied native runtime. An old
`dist/ovule-dev` or an already-built app library does not become ABI-compatible
merely by changing the CLI version. A Framework `0.1.0` / required `2.5.0` error
means an old Rust SDK or stale CLI is still in use; check all three source pins,
`mise run sdk:check`, and any local overrides before trying downloads.

### Uncommitted SDK source changes

For co-development before the SDK Git commit exists remotely, set
`OVULE_TUFFITE_DIR` and `OVULE_TUFF_CLI` in ignored `mise.local.toml` in addition
to the native Distribution override. The first selects local JavaScript SDK
sources; the second must name a CLI rebuilt from the same checkout:

```sh
# In the Tuffite checkout; rerun after CLI/ABI source changes.
mise exec -- cargo build --locked --package tuffite --features cli --bin tuff
```

```toml
[env]
OVULE_TUFFITE_DIR = "/path/to/tuffite"
OVULE_TUFF_CLI = "/path/to/tuffite/target/debug/tuff"
TUFFITE_FRAMEWORK_DIST = "/path/to/tuffite/dist/tuffite-framework-macos-x64"
TUFFITE_FRAMEWORK_DIST_AUTO_DOWNLOAD = "0"
```

The CLI shim and `scripts/cargo.py` apply temporary Cargo patches for the selected
SDK, preserve the published lock, and serialize local SDK commands. Type checks
and Vite use the same SDK's Explorer declarations. Do not add machine-specific
patches to the tracked Cargo configuration. Set
both `OVULE_TUFF*` overrides to empty strings to clear old terminal exports.
Keep the native Distribution override if the matching native release is still
local. Both `mise exec -- tuff` and `mise run tuff -- ...` use the project shim and
honor `OVULE_TUFF_CLI`; a local CLI must report the selected checkout's current
Git commit. Neither path allows ABI checks to be bypassed.

The repository also has native artifacts under
`vendors/tuffite-framework/{macos-x86_64,windows-x64}`. Without an explicit local
override, the app runner can use these vendor artifacts; run `git lfs pull`
after cloning. See [vendored Frameworks](../vendors/tuffite-framework/README.md)
for import, hash verification and platform availability. An ABI transition
requires rebuilding or replacing these vendor artifacts before they can be used.

## Web-only prototype

This is the fastest UI loop, backed by the in-browser mock API. Native dialogs,
SQLite, Agent processes, `<explorer>`, and window controls are not available.

```sh
mise install
mise run install
mise exec -- bun run --cwd desktop --filter @ovule/ui dev
```

Open `http://127.0.0.1:5173/`. Use this only for layout and component work.

## Native app with real Vite HMR

The native loop keeps the Rust backend, SQLite, ShellAPI, dialogs, custom window,
and `<explorer>`, while React/CSS updates arrive through Vite HMR. The development
override is compiled into the default `release.gn` Framework but remains gated by
the direct Tuffite CLI parent, a per-run 256-bit nonce, and an authenticated
loopback readiness probe. Passing `--tuffite-dev-url` directly still fails closed.

Prepare a release-based Framework Distribution in the Tuffite repository once,
or whenever native code changes. For the current adjacent checkout, run this
from the Tuffite repository:

```powershell
python3 x.py package
```

The command runs from `D:\tuffite\src\tuffite` when developing the native
Framework itself. Normal Ovule `dev` and `build` commands download the
matching prebuilt Distribution from the framework's GitHub Release into the
versioned user cache.

Then the normal Web edit loop is one command:

```powershell
mise run dev
```

Mise first invokes `tuff build`, so `build.rs` refreshes ShellAPI bindings, then
runs `mise run frontend` to build Web/extension resources. Production packaging
additionally runs `mise run notices` before copying those resources.
Finally it invokes `tuff dev` or `tuff package`. The manifest's
`beforePackageCommand` also builds the frontend after the native build has
refreshed ShellAPI bindings. Direct packaging therefore rebuilds Web/extension
resources rather than copying a stale `desktop/dist` tree:

```sh
mise x -- tuff package --format app --destination ~/Desktop/ --force
```

On macOS, Extensions and built-in Skills resolve from
`Contents/Resources/assets/desktop/dist/resources` inside the `.app` bundle.

`mise run dev` reinstalls the locked Bun workspace and invokes the current CLI.
The final CLI packaging step invokes the native build and frontend hook again,
so the explicit Mise preparation currently adds redundant build invocations.
Production preparation uses the release profile.
The updated local CLI also defaults its development package to
`target/<triple>/<profile>/ovule`, using Cargo's actual artifact directory
when `target-dir` is customized.
Both `desktop/dist/client/index.html` and the configured resource directories
must exist before packaging. The native resource tree is `desktop/dist/resources/`,
separate from Web client assets. To prepare it explicitly from the repository root:

```sh
bun install --cwd desktop --frozen-lockfile
bun run dev:prepare
bun run dev
```

`build.beforeDevCommand` starts the Vite server after native packaging. Preparation
belongs in `mise run frontend`; the Vite resource hook runs later. If the native
application exits, the updated local `tuff dev` reports its `tuffite.log` path and recent native
errors in the terminal. An `unsupported manifest schema version` error indicates
that the native Distribution and SDK/CLI disagree; inspect `mise run doctor` and
select or rebuild a matching Distribution.

Ovule configures `build.devtoolsPort` as `9234`, so this command also
enables a loopback-only Chrome DevTools Protocol endpoint and prints:

```text
tuffite_devtools=http://127.0.0.1:9234/
tuffite_devtools_targets=http://127.0.0.1:9234/json/list
tuffite_devtools_inspect=edge://inspect/#devices
```

Open `http://127.0.0.1:9234/` and select the main Ovule page or an
`<explorer>` target. The inspector assets are served locally from Tuffite, so this
does not depend on a matching remote Chromium revision. Alternatively, open
`edge://inspect/#devices`, select **Configure**, add `localhost:9222`, then choose
**inspect**. Chrome's equivalent page is `chrome://inspect/#devices`.
Use `tuff dev --devtools-port 9230` to override the port for one run. Tuffite
checks the port before launch and reports a direct error when it is occupied.
Normal production launches do not read this source-tooling setting and do not
open a debugging port.

The CLI reads `build.devPackage`, `build.devUrl`,
`build.beforeDevCommand`, and `build.devtoolsPort` from `tuffite.json`. It automatically rebuilds the
Rust cdylib and refreshes the unpacked development package without writing a
ZIP before starting Vite and the application. Relative paths are resolved from
the manifest directory; explicit CLI flags remain available as one-off overrides. Set
`OVULE_DATA_DIR` when an isolated data directory is desired. Closing the app
or pressing Ctrl+C tears down both the native process tree and Vite.

Development packaging is assembled in a fresh staging directory before it
replaces `dist/ovule-dev`, so resources removed from `bundle.resources` do
not survive as stale Extensions. If an older package is already dirty or held
open by another process, close Ovule and run `mise run dev-clean`; use
`mise run dev-fresh` to clean and launch again in one command.

The Framework manifest selects the Cargo target for the Rust cdylib. In
particular, an x86_64 macOS Framework causes `tuff dev` to pass
`--target x86_64-apple-darwin` even when the development host is arm64.
Tuffite requests `aarch64-apple-darwin` first on Apple Silicon and falls back to
the x86_64 Distribution through Rosetta only when no arm64 artifact is
available. Set `TUFFITE_FRAMEWORK_DIST_TARGET=aarch64-apple-darwin`, or point
`TUFFITE_FRAMEWORK_DIST` at an arm64 Distribution, to require native arm64 and
disable that fallback.

## Checks and production package

```sh
mise run check
# In CI, reject generated changes after Cargo has refreshed the bindings:
git diff --exit-code
```

If another packaged run has the checked-in `desktop\dist` tree open on Windows,
use an isolated output for a compile/bundle check:

```powershell
$env:OVULE_UI_OUT_DIR = "D:\ovule\.tmp\ovule-ui-check"
mise exec -- bun run --cwd desktop build
Remove-Item Env:OVULE_UI_OUT_DIR
```

Build the production package from the application directory with the
cross-platform task:

```sh
mise run package
```

This resolves the version-matched Distribution from the user cache or the
framework GitHub Release. Framework maintainers build it from Tuffite's
non-component `release.gn` profile. The authenticated
development path is present in that same Framework, but normal launches do not
enable it and never start or trust a localhost server.

Run native regressions against the resulting unpacked package:

```powershell
$package = "D:\ovule\.tmp\package-output\ovule-production"
$env:TEMP = "D:\ovule\.tmp"
$env:TMP = "D:\ovule\.tmp"
Set-Location desktop
node smoke/thread-surface.mjs --package-root $package
node smoke/thread-surface.mjs --package-root $package --stress --stress-iterations 30
node smoke/native-ui.mjs --package-root $package
node smoke/native-cdp.mjs --package-root $package
```

Remote Control and Computer Use call Tuffite through `AppContext::shell_api()`
and the generated `tuffite::shell_api::remoting` requests. The transport adapter
uses the shared binary Shell API codec; screenshot bytes become Base64 only
at the Ovule transport boundary. Rebuild the Framework Distribution and
Ovule together after ABI changes; an older packaged Framework cannot validate
this integration.

For the CRD Remote Control and Computer Use path, run the project-level gate
from the repository root after packaging:

```powershell
mise run smoke-crd
```

It validates package integrity, the in-process Remote Control facade, Computer
Use through both Rig Direct and MCP-over-ACP, and a real dual-instance WebRTC
session with an actual decoded desktop frame. To validate a named candidate or
keep isolated logs and profiles for inspection, pass the options through mise:

```powershell
mise run smoke-crd --package-root dist/my-candidate --keep-run-root
```

To check connection crashes without requiring native keyboard/mouse input,
run the connection-only dual-instance test. It still verifies pairing, SDP/ICE,
open data channels, decoded video, and asynchronous session stop:

```sh
node desktop/smoke/remote-control-e2e.mjs --package-root dist/ovule-dev --connection-only
```

Use `--scope package`, `remote-control`, `computer-use`, or `e2e` for a focused
check. The Windows runner starts two independently isolated Ovule apps for
`e2e`; it does not reuse the current product profile or terminate unrelated
Ovule processes.

For a real cross-device check, run the same CRD-enabled build on both devices.
On the Host, open **Manage > Hosts > Paired Devices**, copy **This Host pair
link**, and keep Ovule running. On the Client, open **Manage > Hosts > Remote
Hosts**, paste the link, choose **Continue**, then **Connect**. Enter the
six-digit request shown on the Host and choose **Pair & connect**. Once the Host
is online, use its **Open desktop** icon. A successful check shows a live frame
and latency, jitter, bandwidth, and loss metrics, and accepts pointer, keyboard,
and clipboard input. If either device previously ran a pre-CRD development
build, remove and re-pair that Host (or use **Clear old Link data**) before
diagnosing the transport.

Run the Thread surface, stress, ordinary native, and full CDP scripts serially:
each runner owns and terminates processes from the selected package. The focused
Thread checks validate the isolated `<explorer>` target, shared partition,
root-message RPC, composer geometry, Workbench routing, and repeated session
switches before the broader application regression runs.

The CDP runner uses an isolated D-drive user-data directory and validates the
bundled DevTools discovery/inspector resources, real
Goal/Workflow/Thread and streamed Sample ACP Attempts, Skills/Tools/Models/Agents,
Channel Toolchain plus authorization Gate/Browser presentation, Ollama discovery,
pull and chunk-streamed Thread output, `<explorer>` local/online navigation,
Terminal, Markdown WYSIWYG, reload persistence, and workbench layout. CDP is
never enabled by a normal product launch.

The ordinary native smoke separately validates the custom title bar, all eight
resize hit-test directions, real mouse resize from all four edges, accessibility
tree, SQLite startup, desktop pixels, and the final composed window through
`ui::GrabWindowSnapshot`. Do not run the two native scripts in parallel: both
intentionally stop processes belonging to the selected package.

## Vendored Framework 与核心原生冒烟

匹配平台存在 vendor 时，应用构建和 `scripts/cargo.py tuff` 优先使用
`vendors/tuffite-framework/<platform>`；显式 `TUFFITE_FRAMEWORK_DIST` 优先级更高。
导入和核验参见 [vendors README](../vendors/tuffite-framework/README.md)。
当前 macOS x86_64 Distribution 可用，Windows 仍需导入完整产物。
Rust SDK/CLI 仍从相邻 Framework checkout 解析。

```sh
bun run --cwd desktop build
python3 scripts/vendor_framework.py macos-x86_64
# Python bridge 自动推导 SDK 与 CLI 缓存路径；Mise 仅提供工具和可选本机覆盖
mise exec -- python3 scripts/cargo.py tuff dev --manifest tuffite.json --package dist/ovule-smoke --prepare-only
python3 scripts/smoke_native.py --package dist/ovule-smoke --port 9247
```

冒烟创建隔离 data/profile，验证 ShellAPI snapshot、thread、扩展 Web 模块、
Markdown 写入/读取、workflow node 对应 thread、真实 terminal、Settings scope，
关闭后以同一 profile 重启并检查 SQLite 状态和正常退出。输出的 run root 保存
日志和预期状态，不发送真实 Agent 请求。包必须在代码或 bundle 变化后重新准备。

## Rust IoC composition

Rust services now depend on the dependency-free `tuffite-ioc` contracts;
only the application root enables its `registry` feature. The previous
`ovule-ioc` and `ovule-ioc-container` crates have been removed. Their application
integration tests live in `tests/ioc_agent.rs` and `tests/ioc_channels.rs`.

Factories receive one `FactoryContext<C>` argument exposing `context()` and
`depends_on()`. They implement `Factory<C>`, bind a consumer-owned `KeyedService`
as `Factory::Target`, and return `Arc<Target::Value>` from `build`.
Providers register factories through `Registrar<C>`; the function adapter
`factory` also implements the same Factory interface. Duplicate registration or
injection is an error. Tests select alternative factories before registration.
`freeze()` prohibits further registration on the same Registry while keeping
`get`, `cached`, and `scope` available. Scopes own their Context and local cache,
and inherit missing bindings from their parent. Parent factories use the parent
Context; siblings share parent instances, and child bindings may shadow parent
identities without replacing them. Scopes retain parent ownership.

Ovule owns an `ApplicationContext` containing BrowserContext and its shutdown
policy. Native adapter factories receive this context through `AsRef`, while
business factories remain generic over C. The application root constructs and
starts services explicitly and reads only cached instances during shutdown.

Until the new crate is published in a Git commit, the workspace explicitly uses
`../src/tuffite/crates/tuffite-ioc`. No Cargo patch is installed automatically.
After publication, change this dependency to the same Git URL and commit as the
existing Rust SDK, JS SDK, and Mise CLI pins. At that point bootstrap can use the
SDK's `tuffite::ioc::browser_registry(application_context)` convenience entry.

## Keep the execution Host awake

On the device you want to access, open **Settings → Hosts → Keep this Host awake**.
This local preference defaults to off and is saved in the app data directory's
`host-power.json`. When enabled, Ovule applies it at application startup even
without an open settings page or an active remote session. The status reflects
the native request, and reports a failure instead of treating a saved preference
as an active request. Other devices must enable their own preference separately.

macOS uses a process-owned IOKit idle-system-sleep assertion; Windows uses a
system-required power request. Neither keeps the display on. Turning the switch
off or quitting Ovule releases the request; the OS also releases it after a crash.
Lid closure, explicit sleep, low battery, shutdown and loss of network can still
interrupt remote access. This does not install a background service or launch
Ovule after it has quit.

Native regression (does not put the machine to sleep):

```sh
mise exec -- node desktop/smoke/host-power.mjs --package-root dist/ovule-host-power-validation --keep-run-root
```

The macOS smoke checks the actual process assertion with `pmset`, switch updates,
renderer reload, restore on app startup, release on disable and release after a
forced process exit. Unit tests cover failed acquisition, failed persistence and
corrupt preferences without acquiring real system assertions.

Validated on macOS on 2026-10-20 with the isolated native package: actual system
assertion present while enabled, one request after renderer reload, restored at
app startup, absent after disabling and absent after forced process exit. The
Windows adapter passed cross-target compilation and Clippy; Windows runtime
behavior still requires a Windows device. Four power lifecycle/failure unit
tests, 17 application architecture checks, nine Hosts/localization tests,
TypeScript, ESLint and the production frontend build passed.

## Typed Mojom SDK development

The typed Mojom migration requires the current local Tuffite SDK until its next
release. Published Rust/JS/CLI pins stay unchanged. Select the SDK explicitly:

```powershell
$env:OVULE_TUFFITE_DIR = (Resolve-Path ../src/tuffite).Path
$env:OVULE_TUFF_CLI = "$env:OVULE_TUFFITE_DIR/target/debug/tuff.exe"
bun scripts/tuff.mjs build --manifest tuffite.json
bun run --cwd desktop build
```

The CLI must be built from the selected checkout. The local overlay applies to
Cargo, CLI, TypeScript and Vite, shares the normal dependency cache, and stores its lock in
`.tmp-tuffite-sdk/`. Success and failure both restore the published `Cargo.lock`.
Local SDK commands are serialized to prevent competing lock updates. The Python
Cargo wrapper supports the same override. With no override, published dependency
and tool pins remain authoritative; there is no implicit SDK fallback.

### Service lifetimes

Domain providers use `Registrar::register_eager` for services that must run from
startup; ordinary API services can stay lazy. Bootstrap freezes the registry and
calls `initialize()` once. Factories obtain dependencies through `depends_on` and
return fully initialized owners. Listener configuration belongs in those factories,
not an application startup list.

Browser shutdown drops its registry scope. IoC releases cached ownership in reverse
construction order, and each resource owner cancels and joins its own work in `Drop`.
The same path cleans up a partially failed startup. External `Arc` references extend
actual lifetimes, so background work must not strongly retain its own owner.
Workspace mutations already commit transactionally; session disposal marks remaining
attempts abandoned. A failure in this last cleanup is logged and the normal startup
recovery remains available, since Rust destructors cannot return errors.

After packaging with the explicit SDK override, run
`python scripts/smoke_typed_mojom.py --package dist/ovule-mojom` with Node 22.22+
on PATH. The smoke copies the package and narrows only that copy's permissions.
It checks Browser Rust and C++ typed calls, byte payloads, allow/deny decisions,
incompatible scope rejection, deny precedence and path traversal. Forged channels
and mismatched schemas must fail in native dispatch, while invalid JS arguments
must fail before IPC. The same checks run after graceful shutdown and restart,
including persisted workspace data, with Chromium sandboxing enabled.

## SDK lifecycle compatibility

The current application uses the SDK's Mojom manifest and eager registration
interfaces (`Registrar::register_eager` and `Registry::initialize`). The older
published `b111235` SDK does not provide these interfaces. Until the matching
SDK commit is published and all three public pins can be rolled together, use
the explicit local-SDK overlay described above. This machine's `mise.local.toml`
selects SDK `f0ff3c9edaa6d70bead8a3f0032d18abb2cea439`, its rebuilt CLI, and the
existing ABI `0.1.0` Framework Distribution. Do not replace eager registrations
with lazy registration: Host listeners and lifecycle owners must start at bootstrap.
The overlay keeps the published Cargo.lock intact.

### ShellAPI build channels

Debug and Release have different application identifiers and therefore different
ShellAPI command IDs. Every Cargo profile generates both JavaScript clients into
separate paths: `generated/debug/index.js` and `generated/index.js` (Release).
`cargo check`, tests and Clippy must not replace the Release client with Debug IDs.
Vite HMR selects Debug; `mise run frontend` builds Debug and
`mise run frontend -- --release` builds Release. The build and packaging tasks
forward this choice automatically. `OVULE_BUILD_CHANNEL` explicitly selects the
channel for direct frontend commands.

A `ShellAPI binding mismatch` means the page client belongs to a different
application channel than the running native process. Dispatch status 2 means
`access_denied`, not an ABI failure or a disconnected transport. Rebuild the
native and frontend resources for the same channel; do not bypass command checks.

Raw `tuffite.invoke` payloads must contain an encoded Mojom request struct,
including methods with no arguments. A zero-length payload is a null top-level
Mojo struct and is rejected as `invalid_argument` before any method runs.
Use the generated clients to encode requests.

### Recovering macOS Link credentials after a Keychain reset

If older Link identity files cannot decrypt after the login Keychain changes,
preserve both `workspace-link-host.dpapi` and `workspace-link-client.dpapi` and
the accompanying `workspace-link-access.json`. A new Host identity invalidates
the identity expected by paired devices. Restore the original encryption key
from a trusted Keychain backup instead of resetting Link.

`scripts/recover_macos_link_credentials.py` can authenticate the existing
identities with an Ovule key from a specified legacy Keychain, then re-encrypt
the exact same identity bytes with the current Ovule key. It requires macOS and
Python's `cryptography` package. First run without `--apply` for a read-only check:

```sh
python3 scripts/recover_macos_link_credentials.py \
  --data-root "$HOME/Library/Application Support/io.Ovule.Ovule" \
  --legacy-keychain /path/to/original-login.keychain-db
```

Add `--apply` only after authentication succeeds. The tool backs up existing
encrypted files into a private `secrets/link-recovery-backup-*` directory before
atomic replacement. It does not modify pairing/access records, provider
credentials, or Keychain keys, and never prints keys or decrypted identities.
If either identity cannot authenticate, neither is migrated. An already migrated
identity is left unchanged. Reading credentials with a missing current Keychain
key reports a recovery error rather than creating a replacement key.

For read-only Rust verification, derive the expected public IDs from the
original identities in memory and supply a JSON map keyed by the encrypted
filenames to the `check_link_identities` example. Use the matching build channel
(`--release` for Release data); Debug and Release select different Keychain keys.
This check never creates identities, starts a listener or contacts a peer.

## Sharing Agent conversation diagnostics

Open the bug icon on the affected reply, then choose **Copy diagnostic bundle**
in the dialog footer. Paste that bundle into the debugging conversation. The
versioned report includes the message and its parts, up to four preceding messages
from the same Thread, the correlated Attempt and actual provider/model, lifecycle
events, model rounds, and the durable tool-call journal. Unavailable journal data
is identified explicitly. The report includes message content; transport
credentials and URL query values receive best-effort redaction. It does not read
SecretStore or environment variables.

Automatic findings distinguish empty final answers, tool-round exhaustion,
provider output limits, and tool failures. New model-round events record the
configured output budget, reported token usage, finish reason, reasoning/text
byte counts, and tool names without request arguments. Older Attempts cannot
recover metrics that were never persisted. A thinking-only reply is a failed
Attempt, and reaching the tool-round budget reserves one tool-free completion
for a final answer using existing observations.


## Agent approval and browser downloads

Agent permission requests use the shared AI Elements Confirmation UI. The optional
auto approval checkbox grants the displayed tool only for the current Attempt;
ACP permissions also distinguish operation kinds. Unclassified ACP requests remain
one-shot. Cancelled or finished Attempts do not retain these grants.

Explorer overlays and titlebars show download history after the first download.
The progress ring aggregates active downloads; unknown totals use an indeterminate
ring. Completed files are published into the directory configured in Settings >
General (the platform Downloads folder by default, normally `~/Downloads`).
Same-name files receive a numeric suffix. Browser cache copies remain available
for inline PDF rendering. History and the directory persist in `downloads.json`
in the application's data directory. **Delete file and record** deletes the
published file and its history; missing files can have stale records removed. File deletion failures retain the record
and show an error; **Open in folder** reveals the published file.

Run `bun run smoke:agent-approval` and `bun run smoke:explorer-resources` from
`desktop/` for deterministic UI coverage. These fixtures mock native commands;
run a newly built candidate before claiming native bridge or packaged-app coverage.


### Native startup and browser profile paths

Framework `tuffite.Path.Directories` and `Path.Resolve` require a renderer sender.
Calling them through the native host during `Browser::initialize` returns
`invalid Shell API request` and exits before the main window is created (exit 64).
Download ownership resolves the pinned Framework's native profile layout instead:
`<platform application data>/Tuffite/<application id>/data/profile`, or the explicit
`--user-data-dir` argument. `OVULE_DATA_DIR` remains the independent Ovule service
store override. Keep this layout synchronized when upgrading the Framework.

`desktop/smoke/app-startup.mjs` checks native window startup and exercises download
configuration, publishing, listing and physical file deletion using isolated
profiles and destinations. Add `--finder-launch` to exercise LaunchServices opening
of the `.app` bundle, as used by Finder double-click.


## Chat stream presentation

The conversation directly composes the shadcn Message Scroller from `@ovule/ui/message`:
Message Scroller owns live-edge following, user-turn anchors, history reading and
the jump-to-latest button. Native Thread/Message/Part and extension protocols stay
unchanged. Avoid adding a second unconditional scroll-to-end effect.

Built-in part renderers cover Markdown, reasoning/Trace, Attachment, CodeBlock,
Tool, Terminal and citations. Shared CodeBlock retains Streamdown highlighting and
incomplete-fence support behind the shadcn header/actions; wrap, copy and native
Save file remain available. `terminal`, `console` and `shell-session` fences show
Terminal output; executable script fences remain CodeBlock text. Neither runs code.
Numeric HTTP(S) Markdown references and structured citations use Inline Citation
with a source preview and the existing browser routing.

Structured `tool` parts accept name/title, state, input/output/error and durationMs.
`terminal` accepts command and output/stdout/stderr. `code` accepts code/language.
`citation` accepts url/title/description/label; `sources` accepts a sources array.
Incomplete or invalid JSON is tolerated; unsafe source URLs remain inert.
Trusted tool execution and ACP notifications publish status-only Tool parts with
stable IDs. Partial updates retain ACP titles. Arguments and raw results are not
copied from diagnostic channels into messages; historical conversations cannot
reconstruct tool or terminal content that was never recorded.

Run `bun run smoke:chat-stream` for the real MessageList with simulated incremental
updates, tool expansion/status, terminal output/copy errors, source previews and
history/resume scrolling. `node smoke/message-layout-smoke.mjs` covers highlighted
code, wrap/copy/save and narrow widths. Both use isolated fixture data.


Chat is a documentation composition, not a separate primitive or re-export module.
Each of CodeBlock, Terminal, Tool and Inline Citation owns its CSS module. These
are local theme/Streamdown adapters, not verbatim shadcn CLI-generated source.
The AI SDK helper (`@shadcn/helpers/ai-sdk`) scripts deterministic conversations
for demos and tests through `useChat`; it does not replace the native Rust/ACP
runtime or make generated component markup a requirement. Ovule currently uses
native Thread/Part contracts and native fixture tests rather than the AI SDK
transport. Keep that distinction explicit when reviewing component alignment.


## DeepSeek thinking output and empty-answer recovery

Rig queries the configured provider's `/models` endpoint for the selected model's
output limit, context window and effort metadata. The process-local cache is keyed
by provider, endpoint, model and credential fingerprint (never logged); successful
results live for one hour and failures for one minute. Discovery has a three-second
deadline, a 1 MiB response limit and a 128-entry cache bound.

Normal requests omit `max_tokens` when discovery succeeds, allowing the server to
select its own default. The advertised maximum is a capability, not a recommended
request budget. If discovery is unavailable, DeepSeek still uses its documented
server default; other legacy compatible endpoints retain an 8,192-token fallback.
No fixed 64K thinking budget is applied. Recovery retains a small explicit budget,
clamped to a discovered output limit when available.

A length-truncated completion with no answer and no tool calls may trigger exactly
one additional completion. It retains the original context and completed tool
observations, disables thinking, offers no tools and uses an 8,192-token answer
budget. Private reasoning is not promoted to assistant content or replayed as an
answer. A second empty response fails clearly; unexpected tool requests during
recovery are rejected without dispatch. Ordinary empty `stop` responses are not
retried by this policy. Planning requests retain JSON output requirements.

The diagnostic bundle records per-round budgets, finish reasons, thinking mode,
recovery state and usage when the provider reports it. Legacy `Some(Length)` error
strings are classified without inventing missing token metrics.

Deterministic real HTTP/SSE coverage (no provider credentials or API usage):

```sh
OVULE_TEST_MODE=1 python3 scripts/cargo.py test -p ovule --lib rig_answer_ --offline -- --ignored
```

These tests require permission to bind a loopback listener and verify successful
recovery, one-retry bounds, unrelated empty stops and tool-free enforcement.

## Inline agent approval and transcript regression

Tool permission requests render inside the matching Attempt's assistant message,
using the shared Confirmation component. They retain explicit consent and exact
request IDs; message content cannot create an approval. Background Attempts do not
render requests in unrelated messages. The root lifecycle still owns native event
subscription. Thread renderers subscribe independently of Browser Use; teardown
only denies requests belonging to Attempts presented in that renderer, so closing
an unrelated window cannot reject another conversation's request.

Tool calls are grouped beside reasoning. Groups expand during streaming and collapse
at completion unless the user explicitly chose an expansion state. Individual tool
previews remain available after opening the group.

The conversation uses MessageScroller's follow-bottom mode, without per-user-message
scroll anchors. Scrolling up pauses following; returning to the bottom resumes it.
Resize-based following handles streamed text and delayed content layout, while the
existing history loader preserves the visible position when prepending messages.

Run the isolated browser regressions from `desktop/`:

```sh
node smoke/agent-approval-smoke.mjs
node smoke/chat-stream-smoke.mjs
```

Both use temporary fixtures and synthetic data. Packaged native approval routing
requires the Harness smoke on a newly built candidate; browser results do not
substitute for that check.

## Thread conversation controls

The composer replaces Send with Stop while the Thread has an incomplete Attempt,
including while it awaits approval. Cancellation uses the existing native Attempt
cancellation path; the button stays disabled while cancellation is pending.

Message footers expose Edit prompt on user messages and Fork from here on user
and assistant messages. Editing replaces the prompt text inside its existing
bubble with a focused, auto-sized input. Enter submits, Shift+Enter inserts a
newline and Escape cancels; IME composition never submits. There are no editor
footer buttons. Failed submissions retain the editable draft and an inline error.

Restart keeps the current Thread and original prompt ID. The native service requests cancellation
of active Attempts, retains the preceding history, replaces the selected prompt
and removes its old replies and subsequent turns. Superseded Attempts are terminal
and detached from removed messages, so late text and tool blocks cannot overwrite
the replacement. A fresh Attempt is committed with the edited prompt before
being dispatched in the same Thread. Image attachments are retained; prompts
without images bypass the attachment repository's nonempty-image validation.
The Workspace transaction rolls back on errors before publication.

Only the explicit Fork action creates another Thread. Forks snapshot history
through the selected message, allocate fresh message IDs and preserve immutable
text, images, thinking and completed tool traces. They inherit Agent, model, Host,
project and Workspace selection without copying active tools or approval grants.
The UI uses the explicit fork result ID and does not navigate for prompt restarts.
The mock adapter follows the same Thread-ID and history-replacement semantics.

Run `node smoke/thread-controls-smoke.mjs` from `desktop` for isolated browser
coverage of Stop, pending cancellation, editable draft recovery, fork and Escape.
Use `agent-approval-smoke.mjs` for live review-mode fallback presentation. These
fixtures do not replace the native packaged-app release checks.

## Cancellation and tool-result presentation

Cancellation is a terminal control state, not a failed response. Worker adapters
use the stage-neutral summary `Generation stopped`. Finalization preserves
streamed prose and completed tool evidence, keeps the assistant role and appends
one `notice` part with cancelled status. The UI renders that notice as a small,
localized status row without a colored message background. Old stored
`Agent Worker was cancelled before it started` messages normalize to the same
presentation. A failed response similarly retains partial prose with an expandable
notice; full backend error text is not painted across the message.

Tool rows distinguish `failed` (a command or tool returned an unsuccessful result)
from `error` (dispatch, permission, backend or timeout errors). Titles and group
headers stay neutral; invocation errors use a small warning label. Output, exit
codes and error details remain expandable. ToolGroup counts these two categories
separately and retains the existing completion-collapse behavior.
