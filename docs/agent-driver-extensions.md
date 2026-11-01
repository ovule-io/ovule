# AgentDriver extensions

## 1. Decision

Codex, Claude, Sample ACP, and future external harness integrations are
packaged as `AgentDriver extensions`. An `Agent` remains the user-facing actor and
catalog profile; an extension supplies one or more Driver implementations. This
keeps product terminology stable while making protocol adapters independently
installable and updatable.
The same package can contribute Models compatible with one or more Drivers.

Extensions use JavaScript/TypeScript for fast-moving protocol adaptation, but
JavaScript does not own the Worker process. The long-lived Rust host retains a
small `DriverHost` backend that owns executable selection, process-tree containment, PTY or
pipe handles, cwd, environment/secret injection, sandbox policy, deadlines,
cancellation, output limits, and persistence. The extension receives bounded data
and returns declarative plans or normalized events.

```text
Goal / Workflow -> Attempt
                       |
                       v
              AgentDriver registry
                       | selects signed extension
                       v
        JS adapter runtime (pure, sandboxed)
        - describe/probe plan
        - build argv/config plan
        - parse JSONL/stream events
        - normalize capabilities/errors
                       | validated messages
                       v
              Rust DriverHost (trusted)
        - spawn/process tree/PTY/pipes
        - permissions/secrets/deadlines
        - backpressure/cancel/cleanup
        - durable Attempt event commit
```

## 2. Long-lived JavaScript Utility, narrow authority

The Tuffite Utility Service is a bounded Rust RPC service: one host per
registered service, up to eight concurrent unary invocations, a 64-request
active-plus-queued cap, a 30-second invocation deadline, cooperative
cancellation, and a 1 MiB response limit. JavaScript extensions use the separate
long-lived Utility session contract rather than stretching unary `invoke`.
Sessions have independent Mojo pipes, ordered commands, bounded queues,
explicit event credits/acknowledgement, and independent command cancellation.

The JavaScript Utility can therefore live as long as an Agent Attempt or extension
generation, but it remains capability-free by default. Giving it unrestricted
process, filesystem, network, or secret APIs would move the most
security-sensitive policy into third-party script and defeat the Chromium
utility sandbox. Instead, every privileged operation is a typed request to the
Rust DriverHost backend.

The useful boundary is therefore:

- utility/adapter runtime: untrusted computation and protocol translation;
- Rust DriverHost: trusted resource ownership and policy enforcement;
- SQLite/event store: authoritative Thread and Attempt state.

Long-lived semantic output uses the Utility session's ordered event channel with
bounded batches and credit-based backpressure. Rust validates and persists those
events, then emits best-effort renderer application events carrying a
revision/cursor and optional live delta. Application events are a UI projection,
not the Utility transport. Raw PTY or other high-volume bytes still use a
capability-specific data pipe.

## 3. Extension package

A Driver package is immutable and content-addressed. Bundled first-party extensions
use the same format as installed extensions. Standard npm metadata and build
dependencies live in `package.json`; the fail-closed Host manifest is the
separate `extension.json`. A conceptual Host manifest is:

```json
{
  "schemaVersion": 1,
  "id": "io.ovule.agent.sample",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "apiVersion": 1,
  "runtime": { "kind": "javascript", "entry": "dist/extension.mjs" },
  "contributes": {
    "agents": [
      {
        "id": "sample",
        "label": "Sample ACP",
        "executableCandidates": ["sample", "sample-alias"],
        "toolchain": "sample"
      }
    ],
    "models": []
  },
  "permissions": {
    "process": ["sample", "sample-alias"],
    "workspace": true,
    "environment": ["NO_COLOR"]
  }
}
```

`contributes.agents` is the executable adapter registry. Each item owns its
stable Driver ID, label, exact executable candidates, optional temporary
MCP-config support, and names of required parent-process credentials.
`contributes.models` is the model catalog registry:

```json
{
  "id": "deepseek-flash",
  "label": "DeepSeek Flash",
  "provider": "deepseek",
  "remoteId": "deepseek-flash",
  "agents": ["ovule"],
  "recommended": true,
  "description": "General-purpose DeepSeek model through the official API"
}
```

Agent and Model IDs are globally unique within their respective contribution
namespaces across the loaded extension set, and
every Model `agents` entry must resolve to a contributed Driver (or the built-in
`ovule` Driver). A package may contribute either side independently, so a
model-only package can target an Agent supplied by another package. Conflicts and
dangling references fail the complete catalog load.
The same textual ID may appear in different namespaces, allowing one package to
bind an Agent, Model Provider, and Channel implementation under one product name.

The installed manifest never grants authority by itself. Installation records a
signature/trust decision; activation intersects requested permissions with the
Agent profile, workspace policy, and current Attempt. Unknown fields fail closed
for security-sensitive sections.

`contributes.onboarding` supplies declarative setup UI and bounded Host actions.
Codex declares both its Agent target and OpenAI model-provider setup; DeepSeek
declares its secret field and model-catalog endpoint; Ollama is a built-in,
declarative-only Extension that declares its Toolchain and model-pull action.
The core UI renders this schema and contains no provider-specific React branch.

## 4. Adapter contract

The initial JavaScript surface should be deliberately functional:

```ts
import { defineAgent, defineExtension } from "@ovule/extension";

export default defineExtension({
  id: "io.ovule.agent.sample",
  apiVersion: 1,
  capabilities: ["agent-driver", "acp"],
  agents: {
    sample: defineAgent({
      prepare(input: AttemptInput): SpawnPlan,
      onStdout(state: JsonValue, frame: Uint8Array): ParseResult,
      onStderr(state: JsonValue, frame: Uint8Array): ParseResult,
      onExit(state: JsonValue, exit: ExitStatus): ParseResult,
    }),
  },
});
```

`defineExtension` is the only package-level runtime declaration. The same
module may also contain `modelProviders` and `channels`; `defineAgent`,
`defineModelProvider`, and `defineChannel` validate individual contribution
handlers rather than defining mutually exclusive package types.
Extension TypeScript imports these helpers from the normal
`@ovule/extension` workspace package. Bun bundles that dependency into
`dist/extension.mjs`, so the V8 module has no source-tree or npm resolution at
runtime.

`SpawnPlan` is data, not a process handle. Current ACP adapters use `prepare`
to select their command and leave wire normalization to the shared Rust ACP
client; the stream hooks remain the contract for future raw stdio adapters. It declares
`executableCandidates`, `args`, `cwd`, non-secret `environment`, `stdin`,
`output`, and `finalMessage`. The Host validates the executable
against the manifest, canonicalizes cwd, resolves only declared secret
references, applies hard limits, and then starts the process. `ParseResult` may
contain updated bounded state and normalized events such as assistant delta,
tool call, approval request, usage, diagnostic, final response, failure, or a
typed `message.block`. A message block has a stable ID, a manifest-declared kind,
and bounded JSON data; Rust maps it to a durable assistant Message part rather
than allowing the adapter to call the renderer directly.

The extension cannot call SQLite, emit renderer events directly, read arbitrary
files, open sockets, load native libraries, spawn children, or obtain raw
credentials. It calls the Rust DriverHost protocol for `process.*`,
`workspace.*`, `artifact.*`, `secret.bind`, `approval.request`, checkpoint, and
telemetry operations. Every operation is capability-checked and audited.
Provider credentials such as `DEEPSEEK_API_KEY` are written only by a narrow
trusted ShellAPI command, protected by the host credential store, and resolved
when `DriverHost` creates the declared child process. The plaintext is never
returned to extension JavaScript, Catalog snapshots, event payloads, or logs.

## 5. Runtime shape

The implementation uses a dedicated Utility process with one V8 isolate per
extension hook session rather than a renderer or Node subprocess. ACP planning
sessions are intentionally short-lived because the shared Rust ACP client owns
the live protocol connection; stateful adapters may retain a Utility session.
Tuffite exposes this as `JavaScriptExtensionHost` over the generic Utility session
transport. The purpose-built, capability-free adapter service has:

- module loading only from a verified extension package;
- no DOM, Node compatibility, dynamic native modules, `eval`, network, or ambient
  filesystem access;
- a 32 MiB isolate heap, message-size, queue-depth, and restart limits;
- versioned Mojo commands plus ordered, credit-controlled session event batches;
- isolate termination on budget violation and generation-aware extension handles;
- deterministic conformance fixtures executable without launching a real Agent.

The implementation should reuse Chromium's `gin::IsolateHolder` Utility-isolate
pattern and V8 module compiler. It must not package Node, Bun, QuickJS, or another
JavaScript engine into the product.

Tuffite owns the generic Utility session lifecycle, transport, V8 isolate limits,
and host-call plumbing. Ovule owns the DriverHost protocol vocabulary and all
Agent, model, Skill, Tool, Attempt, and persistence semantics.

## 6. Built-in and third-party policy

Codex is the bundled first-party AgentDriver extension. DeepSeek is a
bundled model-provider extension: its TypeScript adapter supplies a validated
provider plan and the trusted Host executes that plan through the native HTTP
runtime. Sample ACP is a synthetic test package under `desktop/smoke/fixtures/agent-sample`;
it is loaded only after its built `extension.json` and `dist/` are explicitly
installed below the Ovule data directory's `extensions/` folder.
`OvuleAgent` can be another bundled Driver
backed by the selected embedded community runtime.
Agent profiles and AgentDrivers remain separate layers: multiple user-visible
profiles may share `driver: "ovule"` while binding different model IDs,
instructions, Skills, and Tools.

The explicit data-directory installation is the current local trust decision.
Installed packages use the same fail-closed manifest, permission, V8, and Host
validation path as bundled packages. Third-party renderer contributions remain
disabled until signing, revocation, atomic generation updates, and isolated
WebContents support are implemented.

## 7. Migration plan

1. [done] Extract Agent process ownership behind the stable Rust `DriverHost`.
2. [done] Move Codex and Claude metadata, executable selection, argv construction,
   and environment planning into bundled TypeScript extension packages.
3. [done] Add the restricted V8 module runtime and execute a multi-module
   conformance fixture in the packaged Playground.
4. [done] Route real Ovule Sample ACP/Codex/Claude Attempts through the extension
   realm while keeping process, API permissions, sandbox, secret, timeout, and
   persistence ownership in Rust.
5. [done] Drive Agent discovery, Model contributions, compatibility, remote Host
   inventory, and the Manage catalog UI from validated manifests; ship DeepSeek
   Chat and Reasoner through a V8 provider-plan adapter plus the native Host HTTP runtime.
6. [done] Load explicitly installed Host-only third-party packages from the
   Ovule data directory; Sample ACP is the conformance package.
7. Add signature/trust UI, atomic update/rollback, permission review, crash-loop
   quarantine, and isolated renderer support before enabling third-party UI packages.

The shared Extension SDK and manifest now also support custom capabilities and
package-local Web Component Thread blocks. See
[Extension capabilities and Thread message blocks](extension-capabilities.md).
This does not enable untrusted third-party UI code: bundled assets are
reviewed and Rust-validated, while a public marketplace requires an isolated
WebContents renderer boundary.

The verified `0.1.0` vertical slice uses the bundled Codex driver and the
explicitly installed Sample ACP JavaScript AgentDriver. Third-party signing/trust UI,
hot update/rollback, richer async Host operations, and crash-loop quarantine
remain future work; the current installation directory is a deliberate local
trust boundary.
Claude is intentionally absent from the current distribution.
