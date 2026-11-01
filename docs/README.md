# Ovule design

Status: production-oriented vertical slice implemented and release-validated,
2026-09-12. See [Implementation status](implementation-status.md) for the exact
implemented boundary, evidence, and remaining public-release work.

Tuffite is the framework/runtime/framework; Ovule is the Agent Harness product
built on it. Both remain pre-production. Tuffite APIs may be changed
directly when the vertical implementation proves a better shape; do not add
compatibility shims or migration aliases for unreleased APIs. Package versions
remain at the initial `0.1.0`, FFI ABI major 1, and Shell Protocol major 1 until
there is an external compatibility commitment.

Ovule is a local-first agent harness built on Tuffite. Its product center is
an observable `Goal + Dynamic Workflow`: a user states an outcome, Ovule
keeps the goal durable, lets an orchestrator expand the work at runtime, runs
full external agent CLIs, and projects the same event stream to the desktop UI
and messaging channels.

The design deliberately follows the useful part of DeepSeek Harness: scoped
services, typed events, replaceable capabilities, profiles, and an append-only
session log. It does not copy Cordis, build another plugin framework, or
introduce a general distributed workflow platform.

## Documentation conventions

Prefer English for documentation used as a code reference, including architecture
notes, implementation guides, module READMEs and prompt maintenance instructions.
Write new material and substantive updates in English. Translate existing material
when revising it without changing technical meaning, identifiers or commands.

## Design map

- [Rust IoC composition](local-development.md#rust-ioc-composition), [Web construction API](../desktop/packages/ovule-ioc/README.md), [Web container](../desktop/packages/ovule-ioc-container/README.md), [Capability contracts](../desktop/features/README.md) and [Desktop composition](../desktop/README.md): current construction, ownership and import-boundary conventions.

- [Implementation status](implementation-status.md): what is implemented in the
  current `0.1.0` release candidate, what was validated, and what remains.
- [Local development](local-development.md): Web prototype, real native HMR,
  release packaging, and native/CDP regression commands from `ovule/`.
- [Design review](design-review.md): what changed after reviewing the first
  platform-oriented proposal.
- [Code architecture review](code-review-architecture.md): current Rust, desktop
  feature, service-boundary, and IoC/Suspense findings with a staged refactoring plan.
- [Rust service architecture](rust-service-architecture.md): trait boundaries, explicit
  composition, Tuffite DependencyManager scopes, community practice comparison, and a staged
  inversion-of-control migration.
- [Technology selection](technology-selection.md): community-first reuse policy,
  protocol/library choices, and the non-reimplementation list.
- [Remote Control](remote-control-architecture.md): desktop session ownership,
  asynchronous control, sequenced input, media policy and performance gates.
- [Remote Control relay deployment](remote-control-relay-deployment.md): Host-owned
  ICE policy, self-hosted TURN REST credentials, secret provisioning and operations.
- [Remote Host architecture](remote-host-architecture.md): superseding Host-first
  execution model for local, SSH, Link, Dev Container, and managed cloud runs,
  including Host-owned Workspaces and Agents and reconnectable remote Runs.
- [Remote Hosts and Workspaces implementation review](remote-host-workspace-review.md):
  reviewed MVP invariants for stable Host/resource identity, pairing, grants,
  inventory reconciliation, execution enforcement, and remaining boundaries.
- [Remote Workspace, Human Handoff, ACP, and Rig evolution](remote-workspace-acp-rig-plan.md):
  earlier Workspace-first plan retained for Human Handoff, ACP, and Rig details;
  its Workspace execution hierarchy is superseded by Remote Host architecture.
- [Architecture](architecture.md): process model, thin runtime, capability boundaries,
  persistence, IPC, security, and Tuffite integration.
- [Goal and dynamic workflow](goal-and-workflow.md): product semantics, state
  machines, orchestration tools, scheduling, recovery, and saved workflows.
- [Agents and threads](agents-and-threads.md): Codex, Claude, Sample ACP, and Ovule
  Agents, thread identity, capability probes, delegation, and handoff.
- [Extension capabilities and Thread message blocks](extension-capabilities.md):
  custom capability declarations, durable typed blocks, Web Component loading,
  and the bundled ECharts/Excalidraw examples.
- [Skills, Tools, Models, and Agents](catalog-management.md): production registry
  semantics, Agent Skills/MCP compatibility, model aliases, credentials, and
  Agent profile resolution.
- [Connected apps and human handoff](connected-apps-and-human-handoff.md):
  Agent-bound Streamable HTTP MCP connections for arbitrary apps, Appshots,
  SPICE-over-WebSocket remote control, local websockify validation, secret
  boundaries, and current limitations.
- [Agent execution permissions](agent-execution-permissions.md): host policy configuration, per-call approval, model-visible boundaries and process failure classification.
- [Agent tool observability](agent-tool-observability.md): expandable call previews, diagnostic evidence, missing Workspace bindings and raw key input boundaries.
- [Agent layering and progressive discovery](agent-layering-and-discovery.md): runtime/kernel boundaries, pi-agent and Codex references, implemented Rig disclosure, and remaining provider/recovery work.
- [Ovule harness](ovule-harness.md): capability layers, Agent projections, native
  host ownership, toolchains/workflow/storage/skills boundaries, and control feedback.
- [Harness validation](harness-validation.md): candidate evidence, repeated native
  placement checks, performance observations, and unqualified boundaries.
- [Agent capability gap review](agent-capability-gap-review.md): pinned Codex CLI /
  DeepSeek Harness source comparisons, current execution gaps and acceptance priorities.
- [Observability](observability.md): durable event vocabulary, projections,
  live streaming, traces, metrics, redaction, and retention.
- [Desktop product and UI](product-ui.md): Codex-inspired workbench, artifact
  experience, local HTML preview, and Markdown WYSIWYG editing.
- [Channels and onboarding](channels-and-onboarding.md): optional messaging channel first, a
  portable channel contract, Telegram extension points, and low-friction setup.
- [Channel extensions](channel-extensions.md): JS/TS platform adapters, the Rust
  ChannelHost security/durability boundary, Channel, and Telegram portability.
- [Implementation plan](implementation-plan.md): repository layout, milestones,
  framework changes, tests, and release gates.

## North-star experience

1. Install and launch Ovule; no Node, Bun, Python, tmux, database, or public
   server is required at runtime.
2. Create or select a Project, open a Thread, and attach one or more local, SSH,
   or Tunnel Workspaces from the composer.
3. Ovule discovers ACP Agents and always offers the Rig-backed `OvuleAgent`.
4. Describe a goal and its acceptance criteria. The initial workflow may start
   as one agent and expand only when the work requires it.
5. Watch phases, workers, tool calls, approvals, artifacts, cost, and blockers in
   one timeline. Steer the goal without losing completed work.
6. Use Browser Use, open local or remote artifacts through an isolated preview, edit
   Markdown in WYSIWYG, and observe or take over terminals.
7. Optionally connect a optional messaging channel bot through a guided long-connection setup.
   The same goal can then be followed, approved, stopped, or continued from the
   desktop or chat.

## Architectural commitments

- `src/services/` owns the core application rules without a separate crate: explicit profile assembly,
  scoped cancellation/lifecycle, and typed in-process events are enough. There is
  no custom DI or general plugin framework in the first release.
- Goal, workflow, agents, storage, artifacts, UI bridge, and channels are
  capabilities mounted into a profile; none is privileged kernel logic.
- Product ownership is `Project 1:N Thread 1:M Workspace`; Artifacts belong to
  Threads and optionally retain producer Workspace provenance. The Sidebar shows
  Project -> Thread -> Artifact, while Workspace binding remains in the composer.
- The Rust backend in the long-lived Tuffite host is the sole writer of durable
  run state. Ovule has one user-visible Desktop; the same executable may run a
  session-scoped, headless Workspace Host role on a remote machine, but it has no
  independent product state or UI. There is no distributed consensus or second backend.
- External agents remain full processes and every orchestrated Agent implements ACP.
  Ovule does not maintain vendor stdout, JSONL, PTY-screen, or app-server protocols.
- Protocols and infrastructure use maintained community implementations first:
  official MCP/ACP Rust SDKs, Tokio, petgraph, rusqlite, portable-pty, tracing,
  OS keyring bindings, xterm.js, Milkdown, and platform bot SDKs.
- A dynamic workflow is an agent-expanded execution graph under a durable goal.
  JavaScript is limited to UI/message-block and ChannelExtension adapters in a
  restricted Utility runtime; Agent protocol, Workflow, and authority remain in Rust.
- The append-only thread event log is the source for observable run history.
  SQLite projections make queries fast but do not create a second state model.
- UI and channel adapters are projections and command surfaces. They never own
  the authoritative goal or workflow state.
- Tuffite remains a general desktop framework. Ovule-specific orchestration,
  goals, adapters, and channel policy stay under `ovule/`.

## Target first release boundary

The target first release supports one machine/user, durable threads, Goal +
Dynamic Workflow, Agents for Codex and external ACP, desktop plus Channel
thread binding, and the Ovule harness's Browser Use, sandboxed local HTML
preview, Markdown WYSIWYG, and Terminal. The current validated slice covers the
desktop, durable state, full external CLI launch path, Sample ACP end to end, catalog
management, static local HTML preview, bounded terminal execution, Markdown
WYSIWYG, Ollama local-model execution, and guided Channel setup/authentication. A
Ovule-owned Channel transport, the built-in OvuleAgent, full browser automation, preview
leases, persistent PTY sessions, and public-release hardening remain open.

## Primary references

- DeepSeek Harness architecture and its plugin/context/session-log model:
  <https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md>
- DeepSeek Harness product overview: <https://www.deepseek.com/harness/en/>
- Claude dynamic workflows: <https://code.claude.com/docs/en/workflows>
- Botmux, used as the messaging and full-CLI bridge reference:
  <https://github.com/deepcoldy/botmux>
- Milkdown, the proposed Markdown-first WYSIWYG editor:
  <https://milkdown.dev/>
- Channel long-connection event subscription:
  <https://api.example.com/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case?lang=zh-CN>

- [Rust architecture and extension boundaries](rust-architecture.md): crate layout, consumer APIs, runtime ownership, and legacy data reset.

- [Open-source preparation and standalone builds](open-source.md): license scope, upstream notices, public build prerequisites and publication history.

- [Optional private repositories](private-plugins.md)

- [Harness research and crate reuse decisions](harness-research.md)
