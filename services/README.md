# Ovule service domains

`services/` contains source-owning domain crates, without an umbrella crate.
Each domain owns its process hosts, transport adapters and optional SDK integration.
Private `src/framework.rs` or `src/framework/` modules may use `tuffite::*` behind
the Cargo `framework` feature; public contracts remain SDK-independent.
The application composes providers and startup/shutdown order under `src/`.
Domain implementations consume typed ports and never depend on the IoC container
or on the application.

Settings owns catalog rules, consumer DTOs, host discovery and credential/executable
health in one crate. Host implementation is private. `Settings<Snapshot>` keeps the
editing contract independent of workspace projection types; workspace implements
`Settings<AppSnapshot>` through its atomic mutation path. This avoids a
settings/workspace dependency cycle without another contract-only crate.

Workspace owns state transitions and projections, session/transaction contracts,
repository ports and the domain checkpoint adapter. SQLite persistence belongs
to the independent [storage crate](storage/README.md); it does not import any domain or IoC ownership. `providers::open` exposes an opaque repository;
`providers::register_settings` binds workspace-backed settings mutations.

Conversation also owns message submission, command dispatch and attachments.
Its consumer `PlanningObserverFactory` and `ChannelStatusProvider` ports prevent
reverse dependencies on workflow and channels. Workflow provides the observer;
channels implements live status. `crates/ovule-platform` combines reusable file replacement and bundled
resource/path primitives. Secrets retains its independent credential/identity
boundary; setup orchestrates onboarding across settings, workspace and toolchains.

Public domain surfaces expose service traits, DTOs/errors, `Service<dyn Trait>`
identities and providers. Concrete service implementations stay private. Native
owner shutdown preserves stop/join ordering, bounded remoting shutdown, durable
attempt/outbox commits and executor cleanup. Domain resource providers resolve the
packaged bundled tree before development sources under `desktop/`.

## Domain organization

`agent` is the execution kernel: model loop, streaming, discovery registry, admission,
approval, cancellation, deadlines and a journal port. Its only Ovule production dependency
is the neutral `ovule-agent-api` crate, shared with domain provider implementations.
That API owns provider/lease/effect/event contracts and no service registration.

Skills, memory, browser and channels own their `capability.rs` implementations.
Hosts owns workspace/computer transport providers and the lazy MCP client/process lifecycle.
Domains never depend on `ovule-agent` in production; Hosts uses it only in integration tests.

The application composes these domain providers in `src/agent_host/capabilities.rs` and
registers the shared kernel and provider assembly through `src/agent_host/providers.rs`.
`src/agent_host.rs` owns scheduling, Attempt preparation, external ACP adapters and
native host lifecycle. The kernel consumes injected providers and a journal adapter;
it does not resolve IoC services. Native framework approval events remain application adapters.

`hosts` owns local, SSH and Link transport routing and host capabilities; it has no
workspace state dependency. `files` owns document access and native/bound filesystem
adapters. Runtime executors stay with the service that owns their lifecycle.
Small services stay separate when they provide a replaceable capability or own
resources: secrets, toolchains, extensions, setup and remoting retain their ports.

Workspace's persisted document contains separately typed conversation, workflow,
terminal, settings, host and project/binding inventory sections. `serde(flatten)`
preserves the established checkpoint format. Cross-capability transitions still
coordinate through `WorkspaceSession`: candidate state is committed before it is
published, and attempt completion and channel outbox insertion remain atomic.
This is an explicit coordination boundary, not permission to add unrelated fields
to Workspace. Some cross-capability algorithms still live in workspace; moving
them to independent domain services requires narrower transaction ports first.

New or migrated Rust modules use `foo.rs` with `foo/` children rather than `foo/mod.rs`.
The agent kernel and application agent_host trees enforce this convention in boundary tests.
