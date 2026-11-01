# Rust service architecture

Shell commands map generated transport DTOs and errors to consumer contracts.
They resolve typed service identities at the application boundary. Business code
receives ports through construction and never retains a registry or resolver.

## Construction and composition

`tuffite-ioc` defines consumer-owned `KeyedService` identities, `Factory<C>`,
borrowed `FactoryContext<C>`, and `Registrar<C>`. Its optional `registry` feature supplies
`Registry`. Only composition roots own registries, caches and
resolution roots. `freeze` prevents further registration and permits new scopes.

A callable domain exports a trait, its request/result DTOs and errors, a typed
identity such as `SettingsService<AppSnapshot> = Service<dyn Settings<AppSnapshot>>`, and a
`providers::register(&mut impl Registrar<C>)` module. Registration chooses private
implementations; factories resolve only typed consumer dependencies. Test or host
composition selects alternative providers before registration; duplicate bindings
are errors and there is no replacement API.

`src/providers.rs` only composes domain provider registrations. SDK adapters
live privately in their owning service crates behind the optional `framework` feature. There is no aggregate
ApplicationRuntime or NativeEnvironment service. Workspace providers restore durable
state through database/path/settings ports. Conversation providers construct the
conversation service and its ingress alias; agent, channel and transport providers
construct their own independently cached lifecycle owners and consumer capabilities.
Overriding one port does not require replacing an application-wide object.
SDK-free host defaults, file adapters, attachments and executor registration live
in their domain providers. Workspace selects database/data/toolchain/secret roots
and implements persisted transport metadata and HostDirectory; secrets constructs
its store from SecretStoreRoot. Application bootstrap receives the native
`tuffite::ApplicationContext`; domain framework factories derive application-wide
event, utility and remoting adapters from it.

`App: tuffite::Application` freezes and initializes one application registry.
`Profile: tuffite::Browser` creates a child registry with its own native
`BrowserContext`, inheriting application services. Profile state owns preview
grants, Office preview worlds, the isolated UI host and download history. The
Application context publishes only a weak registry handle, preventing context
state from retaining service owners after application shutdown. Native profile
shutdown precedes Application shutdown. Agent and channel aliases share their
original instances, and construction errors unwind already-started resources.
Service identities have no intrinsic concrete factory; forgetting registration
produces an explicit missing-provider diagnostic.

## Crate responsibilities

| Crate | Owns |
| --- | --- |
| ovule-settings | Catalog DTOs/rules, host discovery, generic settings editing contract |
| ovule-workspace | State transitions/projections, atomic mutation, repository ports, checkpoint adapter, workspace management commands and settings mutations |
| ovule-hosts | Local/SSH/Link file, process and git capabilities, transport routing, host lifecycle and authenticated desktop transport |
| ovule-agent | ACP/Rig/MCP drivers, agent process/session lifecycle, channel tool and extension execution ports |
| ovule-conversation | Conversation/agent-session contracts, worker transitions, message submission/commands and attachments |
| ovule-workflow | Ready-task dispatch and completion observer implementation |
| ovule-terminal | Command execution, interactive PTY sessions, shell profiles and execution/event lifecycle ports |
| ovule-browser | Browser Use broker and profile-owned Explorer download history/publication |
| ovule-files | Document contract, native/bound filesystem adapters, executor and content validation |
| ovule-channels | Pairing, delivery, worker runtime, event and worker-source ports |
| ovule-remoting | Signaling/lease rules, desktop backend ports, executor and client sessions |
| ovule-extensions | Package validation/discovery, contribution DTOs and extension actions |
| ovule-toolchains | Executable inspection, installation and registry rules |
| ovule-secrets | Credential/identity port and private encrypted host storage |
| ovule-storage | Generic SQLite checkpoints/events and atomic channel inbox/outbox transactions |
| ovule-platform (crates/) | Reusable filesystem replacement and bundled resource/path primitives |
| ovule-setup | Onboarding orchestration across settings, workspace and toolchains |
| Application src | Provider composition and explicit startup/shutdown order |
| ovule-extension-api | Manifest, permissions, contribution and spawn-plan wire contracts |
| ovule-link-protocol | Link methods, inventory and request/response contracts |
| ovule-link-transport | Iroh transport, framing, concurrency and task cleanup |
| ovule | Application/Profile entry, generated ShellAPI mapping and registry ownership |

The service crates own their implementation sources. Consumers import their
actual crate contracts directly; the application has no compatibility reexports
or mirrored service facades. No service depends on the application, registry ownership, or hidden IoC bridge.
Private `src/framework.rs` or `src/framework/` adapters may depend on the Tuffite SDK
through optional Cargo dependencies; public domain contracts remain SDK-independent. Public providers return consumer traits,
opaque repository implementations, or explicit lifecycle capabilities; reusable
implementations remain private.

Settings uses `Settings<Snapshot>` so its catalog and editing contract do not import
workspace. Workspace provides `Settings<AppSnapshot>` mutations. Message dispatch
consumes conversation-owned planning/status ports implemented by workflow and channels.

## Native integration boundaries

Workspace management lives in private `services/workspace/src/management.rs` with
its consumer contract in `commands.rs`. Project, thread, binding and SPICE commands
select transaction metadata and publish committed revisions. Link and SSH command
policy consumes hosts providers and secrets. Neither management nor
transport owns an SDK handle. Transport accepts `BindingResolver` metadata instead
of depending on workspace state; private workspace transport_bindings and
host_directory adapters translate persisted inventory to those ports. Agent runtime
consumes transport, extension, channels-owned ChannelToolHost and computer-use ports.

Framework-neutral host ICE policy lives privately in remoting and is constructed
through `providers::host_ice_configuration`. Filesystem paths live privately in
workspace and are constructed through `providers::native_paths`. Channel
configuration, outbox and inbound persistence adapters live privately in channels
and return consumer trait objects. Application composition supplies framework
execution and event adapters and owns shutdown order.

### Native responsibility disposition

| Responsibility | Owner and boundary |
| --- | --- |
| Agent ACP/Rig/MCP drivers and sessions | Private implementation in `services/agent`; providers return session/control and lifecycle capabilities. |
| Local, SSH and Link transports | Private implementation in `services/hosts`; consumers use transport/client/resolver traits and lifecycle handles. Binding metadata, Host agent execution, computer use and sessions arrive through ports. |
| Workspace management commands | Private implementation in `services/workspace`, consuming transport providers and transactional workspace state. |
| Channel tools | Channels owns the public tool contract and private workspace persistence implementation; agent consumes that contract. |
| Persisted transport metadata and HostDirectory | Private workspace adapters bind persisted inventory to transport/remoting ports. |
| Remoting and extension framework adapters | Private service-owned SDK remoting and Utility/JavaScript execution implementations. |
| Setup framework adapters | Private model/toolchain executor and event adapters exposed through setup/prerequisite and lifecycle ports. |
| Bound files and domain executors | Private content transport-file adapter and opaque content/remoting lifecycle owners. Setup framework adapters map SDK-owned model/toolchain jobs to setup ports. |
| `providers.rs`, `lifecycle.rs` | Application registration and startup/shutdown order. Each service owns its framework event emission; workspace owns durable restoration. |

Application composition is flat: `src/providers.rs` registers domains and
`src/lifecycle.rs` sequences their startup and shutdown. There is no `src/native/` directory.

Channel workers consume ChannelWorkerSource and ChannelEvents; the native extension
host and framework emitter implement these contracts. ChannelRuntime is an owned
shutdown/control capability. ChannelStatusState is a shared read-model handle with
private state, independent of process ownership. Extension validation yields an
immutable JavaScriptModule DTO; only native composition converts it to a framework
JavaScriptExtensionPackage.

## State and lifecycle invariants

WorkspaceSession copies candidate state, validates it, persists it, replaces memory,
and then publishes. Failed commits leave memory untouched. Duplicate or late output
with no effective change emits no new revision or notification. Workflow observers
run only after effective persisted worker events. Attempt completion and channel
reply enqueue remain one SQLite transaction; ChannelRepository is an optional
capability of WorkspaceRepository.

Application lifecycle stops remoting sessions on their executor with a bounded wait, then
Channel/Driver/Terminal/Ollama/Tunnel owners in existing order. Content executor
cleanup follows worker shutdown. Workspace shutdown commits follow owner shutdown.
Dropping cached Arcs alone does not replace stop/join. Cache entries release in
reverse construction completion order, and cached reads never start unused services
during shutdown.

Agents, files, terminals and computer use retain the selected execution Host.
Remote Hosts resolve their own extensions and executables. Link authorization runs
before extension preparation, and SpawnPlan honors manifest permissions and
contributed executable candidates.

## Validation

Run domain tests and Clippy for the workspace, plus the architecture guards in
`src/architecture_tests.rs`. Provider/registry tests cover overrides, same-instance
caching, cycles, dependency errors and drop order. Compile-fail tests cover FactoryContext
lifetimes and registry feature isolation. Domain tests cover transactional failures,
worker ordering, cancellation, channel outbox, extension validation and remoting
session leases.

Use the explicit local SDK overlay documented in `local-development.md` for
Application/Profile co-development. Domain-only tests do not establish native
adapter compilation or packaged application startup; the packaged `runtime`
smoke exercises both dispatch scopes and real Explorer/PTY services.

## Interactive terminal and execution isolation

Interactive user terminals use application-owned `PtySessions`, with ConPTY on
Windows and native PTYs on Unix. An owner key makes reattachment idempotent.
Each session has bounded input queues and a 512 KiB byte replay buffer; cursors
report dropped history. Detaching a renderer preserves its shell, while explicit
close or application shutdown terminates it. These live sessions are separate
from persisted, timeout-limited command runs. Remote command terminals retain
their existing transport path; remote PTY allocation is not yet implemented.

Shell profiles have stable IDs and separate executable, argument, environment
and starting-directory fields. Automatic discovery considers absolute PATH
entries; custom profiles live in the application's `terminal-profiles.json`,
never in workspace-controlled configuration. The Terminal API can list/configure
profiles. Changing profile requires closing the current session. The local panel
offers profile selection, restart and close.

Agent workspace commands use `WorkspaceTransport::execution_sandbox()` and
`exec_with_permissions`, independently of trusted user terminals. Availability
is reported by the execution host, rather than inferred from SSH/Link names.
Preflight rejects unavailable isolation before approval, and execution checks it
again. macOS uses Seatbelt with call-scoped grants; Windows/Linux and remote
transports without a qualified implementation fail closed. External ACP/MCP
driver processes remain trusted host extensions and are not confined by this
workspace-command sandbox. Browser Use remains HTTP(S)-only and does not inherit
the user's external-protocol launch capability.

## Persisted state and storage

`services/storage` owns SQL schema evolution and transactions. `Store<S>` accepts
a `Checkpoint` (serialized state plus revision) and never imports Workspace or
business services. Workspace implements `Checkpoint` for its own model and its
repository adapter delegates to the store. Schema version 5, table names, events,
channel deduplication and outbox identifiers remain compatible. Completion plus
channel reply creation use the same SQLite transaction.

The persisted Workspace is now composed from `ConversationState`, `WorkflowState`,
`TerminalState`, `SettingsState`, `HostState`, and `WorkspaceInventory`. Each section
lives beside its domain transitions. Flattened serialization retains existing
checkpoint keys; projections continue to expose transport-compatible DTOs. Revision,
ID allocation and commit/publication remain coordinated by WorkspaceSession.
These sections clarify ownership without introducing concurrent stores that could
partially commit a cross-domain operation. Remaining cross-domain algorithms in
workspace must migrate behind explicit transaction capabilities before their
implementation moves into a crate that currently consumes workspace.

Crate names describe capabilities: `ovule-agent`, `ovule-hosts`, and
`ovule-files`. Runtime names describe lifecycle owners: `AgentRuntime` remains
appropriate for start/stop behavior inside the agent capability. Framework-neutral
platform primitives live under `crates/`, outside the business service directory.
