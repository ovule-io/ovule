# Ovule Extension SDK

This directory contains the runtime-neutral JavaScript/TypeScript contract for
Ovule Extensions. One Extension may register Agent, Model Provider, and
Channel adapters together. Host extension modules use standard ECMAScript and
Web Platform primitives only; they must not import Node or Bun APIs. The
production loader runs their self-contained bundle in a restricted V8 isolate
hosted by a Tuffite Utility session.

The workspace-level `../../extensions/` directory contains bundled Codex,
DeepSeek, Ollama, native CRD Computer Use, Office, and visual extensions. Sample ACP and
Channel live below `../../plugins/` as separately publishable third-party packages.
Claude is not part of the current distribution.
All executable JavaScript sources are TypeScript and import the SDK through the
`@ovule/extension` workspace package. `bun run build:extensions` bundles the
SDK and each extension into self-contained files below that package's `dist/`;
those generated `.mjs` files are the immutable package
artifacts. Agent launch plans, the DeepSeek provider plan, and the Channel worker
plan execute through Tuffite's restricted V8 Extension Host. Pure manifest and
Web Component contributions do not carry a placeholder Host entry module.
The Rust Host executes DeepSeek requests through its native OpenAI-compatible
HTTP runtime, without exposing credentials to V8. The Channel transport uses the bundled official SDK worker, while Rust owns
credentials, connection lifecycle, inbox deduplication, Thread bindings, and
durable reply delivery.

Isolated UI contributions declare a native-registered `ui.entry` classic-script snapshot and
use `tuffite.isolated.customElements` inside their managed world. Onboarding forms,
message blocks and file editors mount through isolated handles, rather than main-world
module imports. The `visuals` extension also declares `ui: {type: "iframe"}`
for its `interactive-ui` contribution, mounted directly in a host-owned sandbox
iframe without creating an isolated world.
Onboarding UI owns its markup and interactions; native declarations
retain only the action/input/grant contract needed to execute setup safely. See
[the isolated UI migration guide](../../../docs/extension-isolated-ui.md).

Run the contract check with:

```console
bun run --cwd packages/ovule-extension test
```

The Rust DriverHost/ChannelHost remains the backend of this protocol. An extension
can return declarative Host operations and normalized events; it never receives
raw process handles, arbitrary filesystem/network access, SQLite, or secret
values.

Extensions may also contribute AgentDrivers and their optional model catalog.
Models declare compatible AgentDriver IDs explicitly, so one user-created model
can bind to one or more contributed drivers without a provider-name switch in
the Host:

```json
{
  "contributes": {
    "agents": [
      {
        "id": "deepseek",
        "label": "DeepSeek",
        "executableCandidates": ["codex"],
        "toolchain": "codex-acp",
        "mcpConfig": true,
        "requiredEnvironment": ["DEEPSEEK_API_KEY"]
      }
    ],
    "models": [
      {
        "id": "deepseek-v4-pro",
        "label": "DeepSeek V4 Pro",
        "provider": "deepseek",
        "remoteId": "deepseek-v4-pro",
        "agents": ["ovule"],
        "recommended": false,
        "description": "DeepSeek reasoning model"
      }
    ]
  }
}
```

Provider manifests contain current bootstrap choices, not a permanent allowlist.
After authentication the trusted Host calls the provider catalog endpoint and
persists the returned model IDs. A model selected from that Host-owned catalog
may be passed to the provider adapter even when it was not present in the
package's static bootstrap list.

Each directory contains a normal npm `package.json` and a separate,
fail-closed `extension.json`. Host runtimes are explicit in `extension.json`:

```json
{ "runtime": { "kind": "javascript", "entry": "dist/extension.mjs" } }
```

`javascript` runs a compiled TypeScript adapter in the restricted V8 Utility
realm. `utility` selects a statically registered Rust `UtilityService` from the
application cdylib by service name. It never loads an arbitrary native library
path. Extensions containing only declarative or Web Component contributions
omit `runtime` entirely.

```text
extension-package/
├─ package.json       # npm workspace metadata and build dependencies
├─ extension.json     # Host identity, contributions, runtime, permissions
├─ src/               # TypeScript source of truth
└─ dist/              # self-contained generated runtime and Web assets
```

Only built-in Extension `extension.json`, `dist/`, and explicitly declared
static assets are copied into the application package. Third-party packages are
distributed separately and installed explicitly into the user data directory;
npm metadata, `src/`, and `node_modules/` remain build-time inputs.

The single runtime entry uses `defineExtension`. Role-specific helpers create
contribution handlers instead of mutually exclusive Extension package types:

```ts
import { defineAgent, defineChannel, defineExtension, defineModelProvider } from "@ovule/extension";

export default defineExtension({
  id: "io.example.multi",
  apiVersion: 1,
  capabilities: ["agent-driver", "model-provider", "messages"],
  agents: { example: defineAgent(agentAdapter) },
  modelProviders: { example: defineModelProvider(providerAdapter) },
  channels: { example: defineChannel(channelAdapter) },
});
```

`requiredEnvironment` contains names only. Rust reads those values from the
trusted Host environment after validating the spawn plan and binds them directly
to the child process. Secret values never enter the extension isolate, manifest,
Catalog, or serialized protocol. An adapter is rejected if it attempts to write
one of those protected names through its ordinary `environment` entries.

Extensions may additionally declare product capabilities and trusted UI message
blocks:

```json
{
  "contributes": {
    "capabilities": [
      {
        "id": "visualization.echarts",
        "label": "ECharts",
        "description": "Render charts"
      }
    ],
    "messageBlocks": [
      {
        "kind": "echarts",
        "tag": "my-echarts-block",
        "module": "dist/web/echarts.mjs",
        "style": "dist/web/echarts.css",
        "capability": "visualization.echarts"
      }
    ]
  }
}
```

An Agent adapter emits `{ kind: "message.block", payload: { id, kind, data } }`.
Rust validates the block kind and the 256 KiB JSON payload, persists it with the
Thread message, and the UI passes only `data` plus `streaming` to the registered
custom element. Modules and styles must be relative files inside the immutable
extension package; remote scripts and arbitrary element names are rejected.
Executable Web assets are currently limited to reviewed built-in Extensions.
A third-party Channel may instead declare `hostRenderer: "channel-setup"`; this
selects Ovule's trusted generic setup component and does not execute package
code in the renderer.

The same manifest supports `toolchains`, `computerUse`, and `fileEditors`.
Toolchain entries declare pinned npm/archive installs or externally managed
executables. Computer Use entries identify an extension-owned MCP Tool, its
contributed Toolchain, provider capabilities, and compatible Agents. File Editor entries identify local browser bundles,
supported extensions, and either `read-only` or `editable` mode. See
`docs/extension-capabilities.md` for their complete Host and Web Component
contracts.

`toolchain.install` onboarding actions declare `toolchains` and require matching
process permissions. The host prepares their dependency Toolchains and validates
that installation completed. Their action view sets `requiresAuthentication` to
false, so installation never waits for an account login. `authorization.launch`
declares an `authorization` protocol: `initialize`, up to eight `afterInitialize`
JSON messages, `authorizationResponseId`, `urlPointer`, `completionMethod`, and
`successPointer`. The host validates and transports this bounded JSONL exchange;
provider-specific method names and process arguments belong to the extension.
Only a correlated response can return an ephemeral HTTPS (or loopback HTTP)
`authorizationUrl` for the host UI. URLs with embedded credentials are rejected.
A successful completion notification must follow URL delivery. The host retains
process timeout/cancellation and credential storage. Existing launch actions must
add this protocol declaration; protocol data on other handlers is rejected.
See agent-codex's manifest for a complete example. Secret-field actions can be
hidden by the UI while an already authenticated integration is collapsed.
