# Technology selection and reuse policy

## 1. Default rule

Ovule builds product semantics and integration glue. It does not reimplement a
maintained protocol SDK, PTY, graph library, database driver, editor, terminal,
credential backend, telemetry stack, or platform bot framework merely to keep
the code in one repository.

For Agent and harness-integration capabilities, preference order is:

1. an open, maintained protocol with an official Rust SDK;
2. a stable structured interface from the upstream agent/harness;
3. a widely used community library with acceptable security and release health;
4. a narrow adapter around the upstream executable;
5. custom implementation only for Ovule-specific Goal/Workflow semantics or
   when no suitable implementation survives a documented spike.

Reuse does not mean exposing third-party types throughout the product. Each
dependency is wrapped at the boundary where Ovule adds policy, identity,
durability, or UI projection.

## 2. What Ovule owns

These capabilities express the product and should remain small first-party
modules:

- Goal contract, criteria, evidence, budget, lifecycle, and goal-round policy;
- dynamic Workflow `Node(Task | Gate)` semantics, revision checks, replanning, and
  attempt history;
- mapping thread events into desktop and channel projections;
- workspace permission policy and approval scoping;
- artifact provenance and safe-share policy;
- Channel/Telegram conversation binding and principal authorization;
- Tuffite bridge and the security contract for local preview leases.

Even these modules should use community data structures and protocols internally.
They are owned because their semantics define Ovule, not because their
mechanics need to be novel.

## 3. Community implementation matrix

| Area                       | Preferred implementation                                      | Decision                                         | Ovule boundary                                                                   |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Async runtime              | Tokio                                                         | adopt                                            | runtime bootstrap and bounded task groups                                           |
| Cancellation/task tracking | `tokio-util` `CancellationToken` and `TaskTracker`            | adopt                                            | `Scope` owns child tokens and tracker                                               |
| Serialization              | Serde and `serde_json`                                        | adopt                                            | versioned command/event envelopes                                                   |
| IDs                        | `uuid` with UUIDv7 support                                    | adopt                                            | typed ID newtypes                                                                   |
| Dynamic graph              | `petgraph`                                                    | adopt                                            | Workflow validates transitions and persists stable IDs                              |
| SQLite                     | `rusqlite` with bundled SQLite                                | preferred                                        | one store thread and repositories                                                   |
| MCP                        | official `modelcontextprotocol/rust-sdk` (`rmcp`)             | adopt                                            | scoped tools, policy, and audit                                                     |
| Agent Skills               | `agentskills.io` directory format + `serde_yaml_ng`           | adopt format                                     | validate/import `SKILL.md`; revisit full parser when MSRV <= 1.91                   |
| Model catalog              | `models.dev` API                                              | planned cache source                             | discovery metadata only, never authorization                                        |
| Process containment        | `processkit`                                                  | adopted                                          | tree kill, cancellation, timeout, bounded capture                                   |
| Agent protocol             | official Agent Client Protocol Rust SDK                       | adopt exclusively                                | every Workflow Agent implements ACP; no private stdout protocol                     |
| Agent catalog              | static Rust descriptors plus ACP Registry-compatible metadata | adopt                                            | launch/version/capability metadata only; process authority remains in Rust          |
| Embedded agent runtime     | `rig-core`                                                    | adopt                                            | Rig-backed `OvuleAgent` implementing the same ACP Agent contract                 |
| PTY                        | `portable-pty` from WezTerm                                   | adopt                                            | interactive shell/ACP terminal lifecycle                                            |
| Remote SSH                 | `russh`                                                       | adopt behind a validation gate                   | `WorkspaceTransport`; host-key policy and bootstrap remain Ovule-owned           |
| Remote artifacts           | Apache OpenDAL                                                | adopt behind `ArtifactStore`                     | immutable blobs/object storage, not an active source workspace filesystem           |
| Handoff media              | `webrtc-rs` with TURN over 443                                | adopt behind a validation gate                   | scoped PiP media session, never approval authority                                  |
| Screen capture             | `scap`; `xcap` only for independent screenshots               | adopt behind an OS validation gate               | selected window/display under a capture lease                                       |
| Input injection            | `enigo` or a formal native platform backend                   | capability-dependent                             | only after a separate time-bounded control lease                                    |
| Actor supervision          | Kameo                                                         | defer; spike for remote/session supervisors only | actor references must not enter domain services                                     |
| Git operations             | installed Git CLI with direct argv and porcelain formats      | adopt upstream tool                              | workspace/worktree policy                                                           |
| Tracing                    | `tracing` and `tracing-subscriber`                            | adopt                                            | correlation and redaction layer                                                     |
| Optional OTLP              | OpenTelemetry Rust and `tracing-opentelemetry`                | optional                                         | opt-in redacted export                                                              |
| Credentials                | Rust `keyring` with explicit native backends                  | preferred after OS spike                         | opaque credential references                                                        |
| HTTP                       | `reqwest` with rustls where compatible                        | adopt                                            | bounded platform/provider clients                                                   |
| Terminal UI                | `@xterm/xterm`                                                | adopt                                            | React observation/takeover component                                                |
| Markdown WYSIWYG           | Milkdown                                                      | adopt                                            | CommonMark/GFM and file revision bridge                                             |
| Source editor              | CodeMirror 6                                                  | adopt                                            | Markdown/HTML/JSON source modes                                                     |
| Message channels           | signed JS/TS Channel contributions in Extension packages      | planned                                          | Rust `ChannelHost` owns transport, secrets, identity, inbox/outbox, and persistence |

Versions are pinned through Cargo/Bun lockfiles during implementation. A table
entry does not bypass the dependency acceptance gate below.

The current `agentx-adk-skill` 2.0 parser requires Rust 1.95, while this workspace
targets 1.91. The initial implementation therefore uses the standard file format
with a narrow `serde_yaml_ng` frontmatter parser rather than raising the workspace
MSRV for one component.

## 4. Agent and harness reuse

DeepSeek Harness, Codex, Claude Code, and similar systems already own model loops,
context management, tool invocation, hooks, skills, and native session recovery.
Ovule invokes them as complete runners instead of recreating those features.

Every Agent that participates in Goal/Workflow implements ACP. Ovule does not
maintain vendor app-server, JSONL, stdout, or screen-text Agent protocols. A CLI
without ACP can still run as a normal Terminal process, but it is not presented as
a structured Agent. A vendor or community ACP adapter may wrap that CLI outside
Ovule and then enter through the same official ACP client boundary.
The maintained adapters currently selected are
`@agentclientprotocol/codex-acp` and
`@agentclientprotocol/claude-agent-acp`; both are installed in Ovule's private
Toolchain store with pinned version and integrity. Sample ACP exposes ACP directly.

DeepSeek Harness is integrated only when it exposes a compatible ACP server or a
maintained external ACP adapter. Ovule borrows its thin-composition architecture
but does not vendor or rewrite Cordis.

MCP is the tool-extension standard. Ovule uses the official Rust MCP SDK to
expose Goal, Workflow, artifact, browser, and channel-safe tools to external
harnesses and to consume external MCP servers. Every connection is wrapped with
session identity, policy, approval, timeout, size limits, and audit events. MCP
servers do not become trusted in-process extensions or gain direct database access.

For zero-setup use without an installed CLI, `OvuleAgent` is built on `rig-core`:
it provides a Rust agent runtime, multiple model providers, streaming, typed tools,
and structured output. A validation gate covers tool-call cancellation, streaming
events, provider error normalization, conversation ownership, proxy support, and
integration with the official MCP SDK. Rig types remain inside the implementation
and never enter Goal/Workflow.

The default selection is: reuse a compatible already-authenticated external
harness when it offers the requested capabilities; otherwise offer
`OvuleAgent` with a provider credential or local compatible endpoint. Ovule
never silently downloads or executes an agent runtime. A later installer may
bundle another reviewed harness as a signed component.

For Remote Workspace, Ovule Link is the default beginner path: both machines
run Ovule, the Host shares a folder and displays a credential-free pairing
link plus six-digit confirmation code, and the Client pastes the link and code.
The transport uses end-to-end encrypted QUIC with direct-connect preference and
relay fallback. SSH remains the advanced path with pinned host keys. Link Hosts
resolve Agent adapters from their own private Toolchain store; SSH Hosts must
have the selected ACP server installed and discoverable.

## 5. Explicit composition behind the Extension Host

The first release does not implement a generic type-map dependency container or
an arbitrary native-library loader. Rust profile assembly constructs explicit
trait services using ordinary `Arc` values, while the Extension Host selects a
restricted V8 module or a statically registered Rust Utility service:

```rust
pub struct RuntimeServices {
    pub threads: Arc<dyn ThreadStore>,
    pub artifacts: Arc<dyn ArtifactStore>,
    pub agents: Arc<dyn AgentRegistry>,
    pub tools: Arc<dyn ToolService>,
    pub goals: Arc<dyn GoalService>,
    pub workflows: Arc<dyn WorkflowService>,
    pub channels: Arc<dyn ChannelService>,
}
```

`ProfileBuilder` validates each provider and starts components in dependency
order. `Scope` uses `CancellationToken`, `TaskTracker`, and RAII handles for
lifecycle cleanup. Tokio broadcast/mpsc/watch channels implement the in-process
EventHub according to delivery need.

This preserves the useful DeepSeek Harness qualities—replaceable capabilities,
profiles, events, and bounded lifetimes—without maintaining a Cordis-like
meta-framework. Agent integration uses TypeScript extensions for executable and
argv planning. Rust owns ACP transport, process, permission, secret, timeout,
and persistence authority, while every orchestrated Agent is reached through
the official ACP SDK. If explicit construction
becomes a demonstrated bottleneck,
evaluate established Rust DI/plugin crates before adding a custom container.

An Extension package is capability-oriented rather than role-oriented. Its
single `defineExtension` entry may register Agent, Model Provider, and Channel
handlers corresponding exactly to `extension.json` contributions. npm metadata
and workspace dependencies remain in `package.json`; generated executable and
Web Component modules remain below the package-local `dist/` directory.

## 6. Workflow engine decision

Do not adopt a service-backed durable workflow platform such as Temporal for the
local-first first release. It conflicts with one product, zero external services,
and a small core. Do not write graph algorithms either: `petgraph` supplies graph
storage, cycle detection, topological traversal, and dependency queries.

Ovule adds a small domain state machine because dynamic goal replanning,
evidence, user steering, and observable supersession are product semantics not
provided by a general DAG crate. Before expanding the scheduler, re-evaluate
maintained embedded Rust engines against these requirements:

- single process and SQLite-compatible persistence;
- dynamic append/supersede while running;
- human gates and user steering;
- event-level observability;
- no hosted service or generated worker fleet;
- Goal remains the authoritative product aggregate.

Adopt one only if it removes more Ovule code than its adapter and semantic
translation introduce.

## 7. Channel SDK decisions

No official Channel Rust server SDK was confirmed during design. Community
candidates provide Tokio, OpenAPI, WebSocket long connection, events, and CardKit
support, so reuse a maintained candidate rather than implement the whole
platform. A test-tenant spike compares license, maintenance, optional messaging channel region
support, protobuf framing, reconnect/acknowledgement, token refresh, message/file/
card coverage, rate-limit behavior, dependency safety, and fixture test seams.

If no candidate passes, implement only the missing long-connection and API subset
over established HTTP/WebSocket/protobuf crates. The fallback must remain narrow
and must not grow into a general Channel SDK.

Use the shared JS/TS `defineChannel` contribution API for Channel and Telegram. An extension may bundle
a maintained pure protocol library after review; Rust `ChannelHost` owns network
handles, principal authorization, conversation binding, Goal projection,
outbox/idempotency, credentials, and redaction.

## 8. UI reuse

The UI composes established libraries instead of building editors and terminals:

- shadcn/ui and Radix primitives for accessible interaction;
- Tailwind for styling and Zustand for client projections;
- xterm.js for terminal emulation;
- Milkdown for Markdown-first WYSIWYG;
- CodeMirror 6 for source editing;
- a maintained diff renderer selected by a large-diff and visual spike;
- DOMPurify for HTML rendered inside the trusted App document; raw generated
  HTML always uses the isolated preview WebContents.

Ovule owns the workbench composition, event projections, file revision rules,
and preview security.

## 9. Dependency acceptance gate

Before adoption, record a short decision entry containing:

- exact responsibility removed from Ovule;
- upstream repository, license, release, and maintenance activity;
- supported OS/architectures and Rust MSRV/browser compatibility;
- dependency/native-build footprint and offline packaging impact;
- unsafe code, child-process, filesystem, and network behavior;
- security advisory history and update path;
- cancellation, timeout, backpressure, and error semantics;
- test seam and integration fixtures;
- exit strategy if the project is abandoned.

Prefer official protocol SDKs, then widely used foundations, then narrow
libraries. Avoid adopting a full framework for one helper function. Lock exact
resolved versions, generate an SBOM, run license/advisory checks, and schedule
dependency updates independently of Chromium rolls.

## 10. Explicit non-reimplementation list

Unless a later decision record proves otherwise, Ovule will not implement its
own MCP/ACP wire protocol, PTY/ConPTY backend, terminal emulator, graph algorithms,
SQLite driver, Git, Markdown parser/editor, source editor, native credential-store
bindings, OpenTelemetry exporter, Telegram Bot API client, generic LLM provider
SDK collection, general extension/DI framework, or distributed workflow engine.

## 11. Primary community references

- Official MCP Rust SDK: <https://github.com/modelcontextprotocol/rust-sdk>
- Official Agent Client Protocol Rust SDK:
  <https://github.com/agentclientprotocol/rust-sdk>
- Rig: <https://github.com/0xPlaygrounds/rig>
- Tokio: <https://github.com/tokio-rs/tokio>
- petgraph: <https://github.com/petgraph/petgraph>
- rusqlite: <https://github.com/rusqlite/rusqlite>
- portable-pty in WezTerm: <https://github.com/wezterm/wezterm>
- Russh: <https://github.com/Eugeny/russh>
- Apache OpenDAL: <https://github.com/apache/opendal>
- WebRTC.rs: <https://github.com/webrtc-rs/webrtc>
- scap: <https://github.com/CapSoftware/scap>
- xcap: <https://github.com/nashaofu/xcap>
- enigo: <https://github.com/enigo-rs/enigo>
- Kameo: <https://github.com/tqwewe/kameo>
- Rust keyring: <https://github.com/hwchen/keyring-rs>
- OpenTelemetry Rust: <https://github.com/open-telemetry/opentelemetry-rust>
- teloxide: <https://github.com/teloxide/teloxide>
- xterm.js: <https://xtermjs.org/>
- Milkdown: <https://milkdown.dev/>
- CodeMirror: <https://codemirror.net/>
