# Extension UI in Tuffite isolated worlds

Ovule uses two independent extension runtimes. Background agent/provider adapters
remain in restricted Utility V8 sessions. UI contributions choose an isolated Web Component script or a host-managed sandbox
iframe. An isolated world shares the application DOM and renderer
process; it is not a hostile-extension sandbox. Installed third-party executable
UI remains disallowed by the package admission policy.

Each reviewed package with isolated UI declares `ui.entry: "dist/ui.js"`. Its `src/ui.ts` builds
as a self-contained IIFE with bundled dependencies and CSS. Browser `import.meta.url`
references in dependencies are resolved at build time for classic-script syntax.
The Utility `dist/extension.mjs` remains an independent ESM bundle. UI snapshots
are distributed as native resources, outside the browser's executable asset mount.

`src/isolated_ui.rs` registers validated snapshots through
`BrowserContext::isolated()` in `Browser::initialize`, before windows open. The
package ID is the world name; the allowed origin is `ovule://-`. Tuffite adds the
authenticated development origin alias. This requires the matching local Tuffite
SDK and native Distribution with the isolated capability; the released SDK pin
must be rolled together when publishing this feature. Use the existing
`OVULE_TUFFITE_DIR` / `OVULE_TUFF_CLI` local overlay during Framework development.

The shell's `mountIsolated` shares a world per extension within the document. Each
view owns its request handlers and is disposed on unmount; the world is disposed
when its last view closes, including asynchronous creation/close races. Message
volume therefore does not consume the Framework's 32-world quota.
Message blocks, file editors, onboarding and model-provider setup share this
lifecycle. Host-owned message renderers keep their application implementation.
Extension code is never dynamically imported into the main world.

## Onboarding and settings

There is no host-rendered declarative onboarding form. `contributes.onboarding`
selects a custom-element `tag` in the package's UI world. The extension owns its
inputs, buttons, links, validation feedback and styling. Codex and DeepSeek use an
package-local component implementations and configuration; neither imports UI
source from another extension. Each extension owns its isolated adapter and styles.

Native onboarding declarations retain bounded action IDs/handlers, input names and
kinds, required toolchains, link allowlists and status probes. Legacy display hints
are accepted for package compatibility but are not sent to a host form renderer.
The public setup catalog exposes `inputFields`, `actions`, `allowedLinks` and status.
The host binds extension/setup identity to each mount, checks requested action IDs
and values, and executes native credential/toolchain operations. Stored secrets are
never returned to the UI. New credentials enter the native API only on submission.
The built-in Ollama onboarding uses an embedded application-owned world built
from `desktop/features/settings/isolated/ollama.ts`. It remains owned by settings.
There is no root-level shared `extension-ui` runtime.

## Messages, generated HTML and files

Message UI receives JSON data, streaming state and language. It requests actions
through `context(element).request("extension.action", ...)`; the host supplies the
extension identity. Compose requests only fill the composer for user review.

The `io.ovule.visuals` extension declares message kind `interactive-ui`
with `ui: {"type": "iframe"}`, with no executable module or custom-element tag.
Extension identity is separate from the generic UI transport type. This contribution never creates
an isolated world. The main world's `IframeMessagePart` validates the bounded HTML, applies the existing
script nonce and restricted CSP, and owns a sandboxed opaque-origin iframe. Frame
messages are checked against that specific iframe before reaching the composer.
Cleanup removes the frame and message listener. The same package also owns the
ECharts and Excalidraw isolated components and Office file editors. Its native
`dist/ui.js` snapshot bundles these components and libraries together; the iframe
contribution does not create a world. Message kinds and file editor IDs remain compatible.

Office transfers file bytes as arrays in 32 KiB chunks through property updates.
Export chunks return through requests tied to the active export revision. Transfers
are capped at 16 MiB, checked for ordering and byte validity, and rejected on editor
close or export timeout. The host selects the save path and performs the write.
No function or typed-array reference crosses worlds.

Framework snapshots are limited to 8 MiB each, 32 MiB aggregate and 32 registrations
per BrowserContext. JSON messages retain the 256 Ki UTF-16 code-unit bound.
These are storage/transport limits, not runtime CPU or heap limits.

## Validation

```console
mise exec -- bun run --cwd desktop build:extensions
mise exec -- bun run --cwd desktop typecheck
mise exec -- bun run --cwd desktop test:architecture
mise exec -- bun run --cwd desktop build:app
mise exec -- node scripts/local-sdk.mjs cargo check --offline -p ovule --lib
```

`desktop/smoke/isolated-ui.mjs` runs against a native App page with the UI worlds
registered. It uses CDP to inspect closed shadow roots, verifies separate execution
contexts without ShellAPI, exercises Codex/DeepSeek/Ollama setup, Cloudflare actions,
charts, drawings, sandbox compose, Office edit/export and disposal. It is also called
by core native smoke. `isolated-dom.mjs` is test-only; application UI cannot pierce
these closed roots. The Cloudflare smoke uses the same request protocol with
fixture host responses and performs no cloud mutations.
