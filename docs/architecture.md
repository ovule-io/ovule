# Architecture

See [Rust architecture](rust-architecture.md) for current crate, ownership and lifecycle boundaries.

## Frontend workspace

The frontend separates application composition from capability implementation:

| Package                         | Responsibility                                                                |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `ovule-desktop` (`desktop/`) | Document shell, routes and registry composition                               |
| `desktop/features/*` npm packages            | Source-owning subdomains with declaration/token/provider public APIs               |
| `@ovule/ui`                  | Reusable themed UI primitives                                                 |
| `@ovule/ioc`                 | Factory identities, construction dependencies and read-only React consumption |
| `@ovule/ioc-registry`       | Registries, scopes, instance ownership and Provider lifecycle                 |
| `@ovule/shell-api`           | Generated application transport contracts and schema                          |
| `@ovule/extension`           | Extension contracts and runtime helpers                                       |

Capabilities own their declarations (`.d.ts`), tokens, state, views, hooks, and styles.
Cross-capability implementation imports are forbidden, including through barrels and
formerly shared directories. Reusable UI and IoC mechanics have explicit foundation
package APIs. Token modules default-export a readonly `tokens({ ... })` group, with no named
exports or re-exports. TypeScript validates members; lint validates export form.
Imports follow ordinary boundaries.
Desktop selects implementations through explicit package exports.
`features/` is an organizational directory; desktop owns shared checks and config.
The framework package owns the application frame and exposes an injected content
slot. Message parts owns handoff protocol and pane presentation.

The frontend has no global RuntimeService or authoritative AppSnapshot store. Domain
services own their state; desktop stages wire snapshots coherently before notifications
and derives route readers. AppSnapshot remains a transport DTO. Generated declarations
and schema are packaged as `@ovule/shell-api`; native adapters explicitly load its
/register entry. A scoped I18nService owns centralized locales and an independent
instance supplied through I18nextProvider. See the [Features README](../desktop/features/README.md),
[Desktop README](../desktop/README.md), and [Shell API README](../desktop/packages/ovule-shell-api/README.md).

The UI package owns the semantic light/dark theme and exposes focused component
entry points. Desktop imports those subpaths so unused primitives do not enter
the production JavaScript bundle.

Manage is one framework content route, not a modal dialog or Workbench tab. It
covers the complete framework left panel (Chat Sidebar plus Workspace), closes
when the user selects a Thread, and composes the shared shadcn Sidebar primitive
with Hosts and other capability-owned sections. The titlebar opens Manage at
Connected apps; Host events may deep-link to the Hosts section. Connected apps persists ordinary HTTP
MCP Tools and explicit Agent `toolIds`; the feature owns neither a second tool
registry nor provider-specific execution logic.

## 1. Architectural goal

Ovule should feel like one coherent local agent product while remaining easy
to extend. The architecture uses explicit profile composition inspired by
DeepSeek Harness, one long-lived Tuffite host, and capability-owned domain logic.
The runtime foundation does not know what a goal, workflow, model, terminal,
artifact, or Channel message is.

## 2. System shape

```text
┌──────────────────────────────────────────────────────────────┐
│ ovule.exe: long-lived Tuffite host/browser process        │
│ Rust Runtime = DriverHost/backend + Tokio                   │
│  ├─ SQLite Thread/Goal/Workflow/Attempt store               │
│  ├─ process/PTY/API permission/sandbox/secret ownership     │
│  ├─ AgentDriver registry + Utility session supervisor       │
│  ├─ channel adapters + local activation/MCP endpoint        │
│  └─ window/tray/background lifecycle                        │
└──────────────┬──────────────────┬────────────────────────────┘
               │                  │ Chromium Mojo
               │                  ▼
               │        sandboxed Utility processes
               │        JS/TS AgentDriver extensions
               │        (no ambient authority)
               │
               ├── renderer: React workbench / ShellAPI
               ├── renderer: <explorer> inner WebContents
               ├── Chromium GPU / Network Service
               └── external Agent CLIs owned by DriverHost

                         ▲
                         │ durable channels / local IPC
                  Channel / future Telegram
```

The Rust Runtime in the main browser process is the only durable-state writer.
Renderer windows are replaceable projections, not a second process-level
backend. A window may close while the host remains alive in tray/background
mode. Sandboxed Utility processes may host long-lived JavaScript AgentDriver
sessions, but never authoritative Goal/Workflow state or privileged OS handles.

## 3. Single executable roles

The installed product has one user-facing executable identity. The same binary
enters a role before starting Tuffite:

```text
ovule.exe                              launcher + Tuffite UI
ovule.exe --ovule-role=background  Tuffite host without a visible window
ovule.exe --ovule-role=headless    foreground host profile
ovule.exe --ovule-role=mcp-stdio   scoped MCP bridge
ovule.exe --type=renderer             Chromium-managed child
ovule.exe --type=utility              Chromium-managed child
```

The launcher claims one per-user host identity, initializes the Rust backend and
Chromium services, and then opens the UI. A second launch sends an authenticated
activation message to the existing host. Closing the last window may hide the
application while Goals and channels continue; explicit Quit drains the backend
and terminates the process tree.

There is no generic `agent-worker` executable. The Rust DriverHost spawns and
supervises full agent CLIs directly. Agent-specific JavaScript runs in
Chromium-managed Utility children selected by the extension/session protocol.

## 4. Thin runtime foundation

### 4.1 Service composition and profiles

Rust application bootstrap registers context-aware factories in `tuffite-ioc` with its `registry` feature.
Domain crates use `tuffite-ioc` consumer contracts and keep optional Tuffite SDK integration in private `framework` modules. Application provider composition and lifecycle order live in `src/`. Factories declare
construction dependencies through borrowed `FactoryContext<C>` and `depends_on`; services capture
concrete dependencies rather than retaining the registry. Domain providers own runtime instances; the application sequences
startup and shutdown. See [Rust architecture](rust-architecture.md) for
current composition and lifecycle details.

### 4.2 Scope

A scope carries identity, parentage, cancellation, capabilities, and tracked
tasks using `tokio-util` `CancellationToken` and `TaskTracker`.
The default tree is:

```text
Root
  Project
    Thread
      WorkspaceBinding (1..m references)
      Goal
        Workflow
          Node
            Task
              Attempt
                ExecutionContext (primary + attached Workspaces)
                Agent (reference)
            Gate
      Turn
      AgentRecoveryState
```

Cancelling a scope cancels descendants; RAII handles close listeners and external
resources, and the tracker provides graceful shutdown. A scope is a lifetime
boundary, not a mutable bag of domain state.

The ownership cardinality is `Project 1:N Thread` and `Thread 1:M WorkspaceBinding`.
Reusable remote endpoint identity is stored separately from a Thread-owned binding.
Workspace connection/session resources may be shared below the root runtime, but
their product ownership and capability leases remain scoped to the binding and
Attempt that uses them.

### 4.3 EventHub

`EventHub` uses Tokio `mpsc`, `broadcast`, `watch`, or `oneshot` according to the
delivery contract. It transports typed in-process coordination such as
`AgentOutputDelta`,
`ToolApprovalRequested`, and `ChannelConnected`. It is not persistence. Durable
user-visible transitions are appended through `ThreadLog`, which then emits a
notification. This separation prevents every internal tick from becoming a
database record.

## 5. Capability packages

Capabilities are modules in the initial crate, not separately published crates.
The dependency direction is explicit; the Goal driver is the small integration
layer that consumes Goal, Workflow, and Agents rather than putting orchestration
inside core:

```text
core
 ├─ threads/store
 ├─ tools/approval
 ├─ agents ──────── threads
 ├─ artifacts
 ├─ goals
 ├─ workflows
 ├─ goal-driver ── goals + workflows + agents
 ├─ channels ───── threads
 └─ ipc ────────── threads
```

| Capability | Owns                                                                               | Does not own                           |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------- |
| Thread     | append-only events, inbox, transcript projection                                   | AgentDriver or Workflow                |
| Agent      | registry, driver selection, Worker supervision, native recovery state, and handoff | goal semantics or workflow transitions |
| Tool       | tool registry, execution envelope, approval boundary                               | UI prompts                             |
| Artifact   | immutable blobs, mutable working documents, leases                                 | workflow state                         |
| Goal       | intent, criteria, budget, progress, goal-round driver                              | process spawning                       |
| Workflow   | dynamic nodes, dependencies, scheduling, attempts                                  | model providers                        |
| Channel    | inbound normalization, delivery outbox, conversation binding                       | goal semantics                         |
| IPC        | local transport, handshake, command/event protocol                                 | domain decisions                       |

## 6. Profiles

A profile is explicit code-level provider composition plus validated user
configuration.

### Desktop host profile

Mounts SQLite thread store, local artifacts, Agents, Goal, Workflow, approvals,
scheduler, Utility sessions, windows/tray, a small local activation endpoint,
and optional channels. This is the normal product.

### Headless profile

Mounts the same Rust and Utility capabilities without creating a visible
renderer window. It is useful for servers, CI, and diagnosing channel
connections.

### Test profile

Mounts an in-memory store, fake model/CLI, deterministic clock, fake artifact
store, and no network. Goal and Workflow tests use the same public capability
interfaces as production.

## 7. Agent integration

The Agent registry uses community drivers for embedded and external execution.
Workflow delegates a Task to an Agent by creating an Attempt. The scheduler
dispatches a ready Attempt to the AgentDriver, which starts a WorkerHandle.
An embedded `rig-core` adapter supplies the zero-extra-agent-install path after a
compatibility spike. External AgentDrivers map a normalized Attempt request
onto one of these transports, in order of preference:

1. official structured protocol or app server;
2. headless JSON/JSONL stream;
3. PTY/ConPTY;
4. screen-text heuristics only as a documented fallback.

The normalized adapter surface covers launch, submit, resume, fork when
supported, interrupt, terminal input/resize, native session identity, permission
requests, usage, and event parsing. Unsupported capabilities are reported, not
silently emulated.
Rig, ACP, MCP, and PTY implementation types remain private to their AgentDrivers.
See [Agents and threads](agents-and-threads.md) for the first four Agents,
delegation, drivers, and thread routing, and [Ovule harness](ovule-harness.md) for
Browser, Markdown, and Terminal tools.

Ovule owns durable Thread and Attempt state. External adapters should therefore use
an isolated process session and explicitly declare any runtime configuration;
authentication and project `AGENTS.md`/rules still load, while the selected
model, Skills, MCP Tools, workspace, and sandbox are injected explicitly from
the Ovule catalog. This prevents user hooks or extensions from silently changing
an observable Attempt and avoids persisting a second competing conversation.

The DriverHost maintains one supervisor per live WorkerHandle. It uses bounded
channels and explicit cancellation. A process exit produces an event and a
recoverable Agent/Attempt state; it does not crash the runtime.

Remote Host visual control is a separate data plane from Agent execution. The
target contract lets a running Host advertise `desktop.control`
through Ovule Link so a paired Client needs no bridge URL. Link handles
identity, authorization, leases, CRD SDP/ICE signaling, input, clipboard, and
reconnect control; CRD's WebRTC connection carries the encoded desktop media.
The same application-scoped Tuffite remoting service supplies direct desktop
snapshot/input primitives to the built-in Computer Use facade, so Agent control
and interactive Remote Control share one Chromium-native capture/input backend.
A validated, credential-free development
`wss://` SPICE bridge URL (`ws://` is loopback-only) and the embedded
SPICE-over-WebSocket Client remain as an Advanced fallback. Native SPICE TCP/TLS,
tickets, and credentials are not smuggled through ShellAPI URLs.

## 8. Persistence

### 8.1 SQLite

One per-user SQLite database in WAL mode stores configuration metadata, thread
events, projections, channel bindings, and the delivery outbox. One store actor
serializes mutations; read connections serve UI queries. This matches the
single-writer host model and removes the need for distributed locks.

Static secrets are not stored in SQLite. They live in the OS credential store,
and records retain only a credential reference.

### 8.2 Event log and projections

The append-only `thread_events` table is canonical for run history. Goal,
workflow, thread-list, and unread-count tables are projections. A mutation
appends its event and updates relevant projections in one transaction. Recovery
loads the latest projection revision and replays later events.

This is intentionally narrower than making every product setting event-sourced.
User preferences, adapter definitions, and encrypted credential references are
ordinary configuration records.

### 8.3 Artifacts

Large or high-volume data is stored outside SQLite under a content-addressed
artifact root. Events reference artifact IDs and safe metadata. Mutable Markdown
working documents use explicit revisions and atomic replacement; snapshots are
stored as immutable artifacts when attached to a workflow result.

## 9. UI, local activation, and external IPC

The renderer uses Tuffite ShellAPI directly; it does not need GIPS to reach Rust
state already loaded in the same browser process. GIPS remains an optional
`LocalTransport` for second-instance activation, a separate `mcp-stdio` bridge,
or external local clients. Its synchronous poller runs on one dedicated reactor
thread and exchanges bounded messages with Tokio. No GIPS type appears in Goal,
Workflow, Thread, or Channel APIs.

The first protocol has only four message families:

```text
Hello / Welcome / Incompatible
Command { command_id, expected_revision, body }
CommandResult { command_id, revision, body | error }
Subscribe / EventBatch / Ack
```

Control messages use a versioned JSON envelope for debuggability. Large output,
screenshots, and files remain in the artifact store; messages carry references.
The transport authenticates the same OS user, verifies a per-daemon bootstrap
token, and rejects incompatible protocol majors.

The UI reconnects with its last durable event cursor. A missing range triggers
a new projection snapshot instead of best-effort guessing.

### 9.1 Unified `ovule://` URLs

Ovule registers exactly one custom scheme: `ovule`. Product deep links,
OAuth callbacks, and internal resource URLs use different hosts under that scheme:

```text
ovule://app/                                      main application
ovule://app/projects/<project-id>
ovule://app/projects/<project-id>/threads/<thread-id>
ovule://app/workspaces
ovule://app/artifacts/<artifact-id>
ovule://auth/<provider>/callback                  non-rendering callback
ovule://p-<lease-id>.preview/<relative-path>      isolated preview origin
ovule://a-<artifact-id>.artifact/<resource>       isolated artifact resource
```

There are no `ovule-preview://` or `ovule-workspace://` schemes. Workspace
references in domain/events are typed IDs; a shareable Workspace deep link points
to `ovule://app/workspaces?workspace=<id>` and never grants file access.

One scheme does not mean one security origin. Chromium origin remains
`scheme + host + port`: the trusted App is only `ovule://app`; each preview
lease has a unique `p-<lease-id>.preview` host; artifact resources use restricted
`*.artifact` hosts. ShellAPI, service workers, storage, navigation policy and CSP
are registered per host class, never for the entire `ovule` scheme. Revoking a
lease removes its mapping and clears that host's origin data.

A single `OvuleUrlRouter` parses and validates every custom URL before dispatch.
Feature modules create typed `AppDeepLink`, `PreviewResourceUrl`, or
`AuthCallbackUrl` values rather than concatenating strings. HTTP/HTTPS targets are
not deep links: they are always opened by `BrowserService` in the Workbench Browser.

Deep links are navigation references, never command authorization. They may select
a Project, Thread, Artifact, Workspace inspector, pane, or event cursor, but cannot
approve, delete, grant a capability, execute a command, or embed credentials. A
`ovule://` navigation initiated by untrusted web content requires a user gesture
and confirmation when it crosses into the App; OAuth callbacks are accepted only
with a live state/PKCE transaction and never render provider-controlled content in
the trusted App origin.

## 10. Tuffite bridge

The Tuffite application process contains the Rust backend. Renderer commands are
short operations such as `goal.create`, `workflow.cancel`, or `document.save`;
they mutate local durable state or enqueue work and return an accepted result.
Backend projection notifications are batched as Tuffite application events.

Long agent work does not execute inside a ShellAPI handler. A long-lived Tuffite
Utility session may host the sandboxed JavaScript AgentDriver, while the Rust
DriverHost owns the external Worker, permissions, secrets, sandbox, and durable
state. ShellAPI remains a unary renderer control plane. Ordered Utility session
events flow to Rust with credits/acknowledgement; only after validation and
persistence does Rust emit a compact application event announcing a newer
revision/cursor. Renderer events may be missed across navigation or reconnect
and are never the durable log.

There is intentionally no generic ShellAPI `AsyncIterable`. The current bounded
Terminal uses a capability-specific, line-oriented Tuffite event with run owner
and sequence metadata; its final bounded output is committed once as durable
state. Terminal/model output, file bodies, and browser artifacts have different
flow control and lifecycle rules, so future high-rate bytes use
capability-specific PTY/DataPipe or artifact transports. Utility sessions carry
bounded semantic event batches, not arbitrary raw streams. The existing
asynchronous one-shot Utility API remains for finite work; persistent sessions
use the separate Tuffite session contract.

## 11. Security boundaries

- The optional local activation/external endpoint accepts only the current OS
  user and a valid bootstrap token.
- Renderer documents never connect to GIPS directly; they use the Tuffite bridge.
- The App WebContents receives ShellAPI; HTML previews and remote pages do not.
- Agent child environments are allowlisted by DriverHost. Channel secrets,
  unrelated provider keys, and host bootstrap tokens are not inherited.
- File tools operate against canonical workspace roots and explicit grants.
- Tool and channel actions carry actor, thread, goal, attempt, and correlation IDs.
- Approval can narrow a request but cannot expand permissions denied by the
  workspace or application manifest.
- Payload logging is deny-by-default; secrets and user-selected private paths
  are redacted before events reach UI or channels.

## 12. Tuffite ownership boundary

Tuffite has no production compatibility contract yet. Framework changes proven by Ovule
improvements may make direct breaking API changes, provided Playground and every
other in-repo consumer are updated atomically. Do not preserve obsolete shapes
through compatibility shims. Keep initial package/protocol versions unchanged
while the work remains internal and unreleased.

The following are suitable general Tuffite improvements:

- single-instance activation and background/tray window lifecycle;
- a capability-bounded local preview URL loader;
- efficient batched application-event invalidation with revision/cursor
  recovery, plus capability-specific DataPipe/PTY transports where needed;
- long-lived Utility sessions with ordered events, credits/acknowledgement,
  health, cancellation, and generation-aware handles;
- generic window events and close veto;
- hardened Explorer navigation, download, popup, and crash policy.

Goals, workflows, Agents, Channel, Telegram, prompts, and Ovule storage
remain application-owned. Any required Chromium-owned patch follows the root
`AGENTS.md`: it is buildflag-isolated, implemented under `src/tuffite/`, and
integrated through mirrored `.gni` files and narrow boundary markers.

## 13. Extraction triggers

Do not split a module into another process or crate merely for conceptual
purity. Extraction needs one of these demonstrated triggers:

- the component must survive daemon failure independently;
- it executes untrusted native code requiring an OS sandbox;
- its dependency or release cadence is independently versioned;
- measurements show isolation materially improves responsiveness or memory;
- another Tuffite application needs the same stable API.

The repository root is the Cargo workspace; `desktop/` is the Bun workspace. Bundled extension/plugin runtime files, skills and the toolchain catalog are staged by Vite in `desktop/dist/resources`. Browser modules are mounted by `app.assets`; native providers read the staged disk tree. Managed toolchain installs retain their data-directory lifecycle.
