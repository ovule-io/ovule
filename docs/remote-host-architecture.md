# Ovule Remote Host architecture

Status: target architecture. Durable Host-supervised Runs, reconnect journals and
new Host kinds below are planned unless explicitly listed as implemented. Current
Link identity/resource/grant invariants are summarized at the end of this page.

Ovule replaces the current Remote Workspace product model with Remote Host.
A Host is an execution environment that owns Workspaces, Agent installations,
processes, terminals, tools, and durable Agent runs. A Workspace is only a
confined root on one Host; it no longer determines where an Agent runs.

The project is still in MVP development. This design intentionally removes the
old `workspace_path`, workspace-kind-driven execution, endpoint, and Workspace
Link compatibility surfaces instead of maintaining dual models.

## 1. Product decisions

1. Every Attempt runs on exactly one Host.
2. An Attempt may attach multiple Workspaces, but all attached Workspaces must
   belong to that Host.
3. Local is represented by a built-in `Local Host` and uses the same domain and
   service contracts as remote execution.
4. SSH machines, Ovule Link machines, development containers, and managed
   cloud sandboxes are Hosts. A container is a child Host rather than a special
   Workspace kind.
5. Agents are discovered and launched on the selected Host. Agent availability
   is never inferred from whether a Workspace looks remote.
6. Selecting a different Host affects future Attempts only. Existing Runs keep
   their immutable Host, Agent, Workspace, and capability provenance.
7. A single Attempt never spans Hosts. Multi-Host work is represented by
   multiple Workflow Tasks with explicit dependencies.
8. A remote Run may continue after the Desktop disconnects or exits. The Host
   keeps a bounded durable Run journal and replays events after reconnect.
9. Desktop remains authoritative for Project, Conversation Thread, Workflow
Node, Workflow Node Thread, Goal, Workflow, Message,
   and final Artifact metadata. A Host is authoritative only for its live Run
   state and unacknowledged execution output.

This combines the two useful remote-development properties: execution stays
beside the source and tools, as in VS Code Remote, while an already dispatched
session can continue independently of the current UI surface, as in Claude
Remote Sessions.

## 2. Product hierarchy

```text
Project
  +-- Conversation Thread
      +-- ThreadHostContext ----> Host
      |                            +-- Workspace
      |                            +-- HostAgentInstallation
      |                            +-- Tool/runtime capabilities
      |                            +-- HostRun
      +-- Message
      +-- Goal / Workflow
      |   +-- Workflow Node Thread ----> Host + Agent + Workspaces
      +-- Attempt ----> immutable AttemptExecutionContext
```

`/goal` planning and every execution-time replan receive this Host inventory.
The Agent may move newly appended Nodes between Hosts, Agents, and granted
Workspaces using exact IDs; an already started Workflow Node Thread never changes
execution location.

`Host` means a logical execution environment, not necessarily a physical
machine. A rebuilt development container can retain a stable Host identity
while receiving a new Host Instance generation.

## 3. Domain model

```rust
pub struct Host {
    pub id: HostId,
    pub display_name: String,
    pub kind: HostKind, // Local | Machine | DevContainer | ManagedSandbox
    pub parent_host_id: Option<HostId>,
    pub lifecycle: HostLifecycle,
    pub trust: HostTrust,
    pub preferred_connection_id: Option<HostConnectionId>,
}

pub struct HostConnection {
    pub id: HostConnectionId,
    pub host_id: HostId,
    pub connector: HostConnectorKind, // InProcess | Ssh | Link | Managed
    pub config_ref: SecretRef,
    pub pinned_identity: HostIdentity,
}

pub struct HostInstance {
    pub id: HostInstanceId,
    pub host_id: HostId,
    pub generation: u64,
    pub status: HostStatus,
    pub protocol_version: ProtocolVersion,
    pub build_hash: String,
    pub capabilities_revision: u64,
}

pub struct Workspace {
    pub id: WorkspaceId,
    pub host_id: HostId,
    pub display_name: String,
    pub root: HostPath,
    pub source: WorkspaceSource,
    pub persistence: WorkspacePersistence,
    pub trust: WorkspaceTrust,
}

pub struct ThreadWorkspaceAttachment {
    pub thread_id: ThreadId,
    pub workspace_id: WorkspaceId,
    pub access: WorkspaceAccess, // ReadOnly | ReadWrite
    pub sort_order: i32,
}

pub struct ThreadHostContext {
    pub thread_id: ThreadId,
    pub host_id: HostId,
    pub agent_profile_id: Option<AgentProfileId>,
    pub workspace_ids: Vec<WorkspaceId>,
}
```

`ThreadHostContext` remembers a Thread's last Agent and Workspace selection for
each Host. Switching away from a Host does not discard its context.

Agent metadata is split into:

- `AgentDefinition`: the product-known Agent kind and ACP expectations;
- `HostAgentInstallation`: a probed executable, version, authentication state,
  health, and capabilities on one Host;
- `AgentProfile`: user-facing model, Skill, Tool, and instruction policy.

The composer selects an Agent Profile. Dispatch resolves it against an
installation on the selected Host. Missing installation, authentication, or
capability is a visible blocking condition, never an optimistic assumption.

Every Attempt stores an immutable execution snapshot:

```rust
pub struct AttemptExecutionContext {
    pub host_id: HostId,
    pub agent_profile_id: AgentProfileId,
    pub primary_workspace_id: Option<WorkspaceId>,
    pub attached_workspaces: Vec<AttachedWorkspace>,
    pub relative_cwd: Option<WorkspaceRelativePath>,
    pub capability_snapshot: CapabilityGrantSnapshot,
}
```

## 4. Remote execution runtime

The Agent supervisor and ACP client run on the selected Host. Running only the
Agent child remotely while keeping its ACP client in Desktop cannot survive a
Desktop shutdown.

```text
Ovule Desktop
  Product DB / Workflow scheduler / UI / Host controller
                         |
                         | stable Link methods + capabilities
                         v
Ovule Host Runtime
  Workspace services / Agent inventory / AgentRunSupervisor
    +-- ACP client
    +-- external ACP Agent or Rig Agent
    +-- scoped MCP processes
    +-- process and PTY sessions
    +-- bounded durable Run journal
```

The Host journal is not a second product database. It stores only idempotency
keys, execution specification hashes, state transitions, bounded output chunks,
artifact references, pending user requests, and acknowledgement cursors. It is
subject to TTL, size limits, redaction, and explicit cleanup.

Dispatch uses an idempotent two-phase flow:

1. Desktop creates the Attempt and immutable execution context locally.
2. `PrepareRun(attempt_id, spec_hash, context)` durably records the run on Host.
3. Host returns its resolved plan and `remote_run_id`.
4. Desktop persists that mapping and calls `StartRun`.
5. After an ambiguous disconnect, Desktop queries by `attempt_id`; it never
   blindly starts a duplicate process.
6. Host events carry a monotonic sequence. Desktop reconnects from its last
   acknowledged sequence.
7. Cancel, approval, terminal input, and takeover commands carry Host Instance
   generation so stale connections cannot control a replacement instance.

`disconnected` is a Desktop connection projection, not a terminal Run state.
Durable states are preparing, waiting-for-host, queued-on-host, running,
waiting-for-approval, waiting-for-user, succeeded, failed, cancelled,
interrupted, and lost.

Desktop does not schedule a later Workflow node while offline. An already
dispatched Attempt may finish; the next node waits for Desktop reconciliation.

## 5. Host provider and protocol boundaries

```rust
trait HostProvider {
    async fn provision(&self, template: HostTemplate) -> Result<HostInstance>;
    async fn start(&self, host: HostId) -> Result<HostInstance>;
    async fn stop(&self, host: HostId) -> Result<()>;
    async fn delete(&self, host: HostId) -> Result<()>;
    async fn connect(&self, host: HostId) -> Result<Box<dyn HostConnection>>;
}

trait HostConnection {
    async fn hello(&self, request: ClientHello) -> Result<HostHello>;
    async fn list_workspaces(&self) -> Result<Vec<WorkspaceDescriptor>>;
    async fn probe_agents(&self) -> Result<Vec<HostAgentDescriptor>>;
    async fn prepare_run(&self, request: PrepareRun) -> Result<PreparedRun>;
    async fn start_run(&self, run_id: RunId) -> Result<()>;
    async fn cancel_run(&self, run_id: RunId) -> Result<()>;
    async fn subscribe_run(&self, run_id: RunId, cursor: u64)
        -> Result<RunEventStream>;
    async fn respond_to_request(&self, response: UserResponse) -> Result<()>;
}
```

Protocol v2 starts cleanly with no v1 compatibility path:

```text
ClientHello / HostHello / Incompatible
Command { request_id, host_generation, deadline, trace_context, lease, body }
Response { request_id, result | error }
Subscribe { stream_id, generation, from_sequence, credits }
EventBatch { stream_id, generation, first_sequence, events }
Ack { stream_id, through_sequence, credits }
BlobOpen / BlobChunk / BlobClose
Heartbeat
```

Control, Agent events, PTY, and blobs use separate logical streams so large
output cannot block cancellation or approval.

The executable keeps one distribution identity:

```text
ovule
ovule --role=host --stdio
ovule --role=host --connect <link-or-relay>
ovule --role=host --managed <instance-token>
```

SSH is a bootstrap and connection mechanism. Ovule Link pairs a Host rather
than a directory. Pairing grants a Desktop identity permission to connect but
does not expose arbitrary roots. Workspaces are registered separately and each
Run receives a narrow capability lease.

The MVP Link flow is deliberately two-phase:

1. **Pair device** authenticates the Desktop's stable public-key identity with
   the Host. The Host link carries routing identity plus a rotatable random
   pairing token; it is not a Workspace grant. Regenerating it invalidates old
   unpaired links and pending OTPs without revoking paired devices.
2. **Add Workspaces / Agents** stores an allowlist per paired device. The Host
   owner can add or remove canonical Workspace IDs and available Agent IDs at
   any time. `Hello` returns only that device's current allowlist, and every
   Workspace operation checks the same grant before resolving a root.

Adding a new Host Workspace never grants it to existing devices implicitly.
Changing a device grant takes effect on its next request/refresh and does not
require a new pairing code. Revoking the device removes both the pairing and
all of its resource grants; the same device can then complete a fresh pairing
against a newly copied link. Pair links contain routing identity and an
invitation, not a global protocol number. Link uses stable named methods and
optional fields; `host.hello` advertises semantic capabilities, and an unknown
method fails only that request without invalidating the pairing or unrelated
Host features.

The Host inventory is authoritative. A Client does not need
to install the same Agent Extension merely to display or select a remote Agent.
`SpawnAgent` sends the Agent ID and optional model reference; the execution Host
resolves its own Extension, Toolchain, executable, arguments, and environment
before opening the ACP stream. Paired-device and Remote Host cards expose live
Online/Offline state rather than inferring connectivity from persisted grants.

A Dev Container is a child Host. Rebuild changes its Host Instance generation.
A managed cloud Host is created from a template containing image, resources,
Workspace sources, devcontainer config, idle timeout, maximum runtime, and
persistence policy. Creating billable infrastructure is always explicit;
starting an existing stopped Host may be automatic when its policy allows it.

## 6. Thread interaction

The Thread title bar replaces Choose Agent with a single-select Choose Host
control. It groups `Local Host` and Remote Hosts, shows connection/lifecycle
status, active Run count, and actions for adding or managing Hosts.

Selecting a Host:

- changes only future Attempts;
- restores that Thread's saved Host context;
- filters both Workspace and Agent choices;
- does not migrate, cancel, or hide existing Runs on other Hosts.

The composer leading actions become:

```text
[Attach] [Attach workspace] [Choose agent]                         [Send]
```

Choose Agent sits immediately to the right of Attach Workspace. The old visible
Enter/Shift+Enter shortcut hint is removed. Workspace selection only lists
Workspaces on the selected Host. The first selected Workspace is primary and
additional Workspaces are read-only by default unless policy grants writes.

Agent rows expose Ready, Login required, Installing, Unavailable, or
Unsupported. A missing Agent blocks send and offers Install Agent, Sign in on
Host, or Choose another Host. Ovule never copies local Agent authentication
to a remote Host implicitly.

Message send is atomic and includes all execution choices:

```ts
sendMessage({
  threadId,
  clientRequestId,
  content,
  attachments,
  execution: {
    hostId,
    agentProfileId,
    primaryWorkspaceId,
    attachedWorkspaceIds,
  },
});
```

New Thread creation uses `createThreadAndSend` with the same execution payload,
instead of separate create/select/send calls.

Every Attempt card displays Host, Agent, and Workspace provenance. The UI can
state `Running remotely - Desktop may be closed`, `Reconnecting`, `Caught up N
remote events`, and `Completed while Ovule was closed` without confusing
connection health with Run outcome.

The former Remote Workspaces dialog becomes Hosts. Each Host card contains
connection identity, lifecycle controls, Workspace roots, installed Agents,
active Runs, and revoke/delete operations. Link deep links move from
`/workspaces/link` to `/hosts/link`.

The Hosts surface loads the local Host status when it opens so previously
paired client devices and their current Workspace/Agent grants are visible
without generating a new pairing link. On the client side, attached resources
are grouped under **Remote Hosts**, with each Host owning its nested Workspace
list. Host runtime IDs are projected through the local Agent catalog into Agent
profile IDs before the composer picker is rendered; this allows multiple Agent
profiles backed by one granted runtime while preventing ungranted profiles from
being selected or dispatched.

## 7. Security requirements

- Host identity is a stable public key. Network addresses are routing metadata.
- Each Host Instance has a generation; old-generation control frames fail.
- Every Run lease limits Attempt, Workspaces, Agent, Tools, deadline, and budget.
- Remote paths are canonicalized and confined on Host.
- Pairing a Host does not grant whole-filesystem access.
- Agent-native authentication remains on Host.
- Desktop secrets are not sent by default. Explicit delegation uses revocable,
  run-scoped secret leases and avoids persistence where possible.
- Journal, trace, and artifact content is redacted before persistence.
- Managed Hosts enforce maximum runtime, output/disk quota, idle suspension, and
  one-action revocation.
- New approvals wait while Desktop is offline; they are never auto-approved.

## 8. Direct replacement map

| Remove | Replace with |
| --- | --- |
| `Thread.agent` | `ThreadHostContext.agent_profile_id` |
| `Thread.workspace_path` | `Workspace.host_id + Workspace.root` |
| `Thread.workspace_binding_ids` | `ThreadWorkspaceAttachment` |
| `WorkspaceBinding.kind` | `Workspace.host_id` |
| `RemoteEndpoint` | `Host + HostConnection` |
| `resolve_agent_for_target(remote: bool)` | `resolve_agent(host_id, profile_id)` |
| execution through `WorkspaceTransportRouter` | `HostProvider + HostConnection` |
| Link `share_id` as connection identity | Host pairing plus Workspace registration |
| abandon all incomplete Attempts at startup | Host Run reconciliation |
| `RemoteWorkspacesDialog` | `HostsDialog` |
| `remoteWorkspaces.open` | `hosts.open` |

The current Rust aggregate named `Workspace` should be renamed to `AppState` so
it no longer collides with the actual Workspace resource.

## 9. Delivery slices

1. Host-first domain and Local Host UI: remove legacy Thread execution fields,
   route local execution through Host contracts, and implement the two pickers.
2. Promote Link and SSH to Hosts: Host-level pairing/bootstrap, Workspace and
   Agent inventories, and one remote Agent vertical slice.
3. Durable remote Runs: Host supervisor, two-phase dispatch, journal, cursors,
   reconnect, remote cancel, approval, and artifact retrieval.
4. Dev Container and managed Host providers: parent/child Hosts, rebuild
   generation, Git/volume sources, lifecycle and cost controls.
5. Security and reliability hardening: identity pinning, leases, redaction,
   process-tree cleanup, protocol fuzzing, and long-running reconnect tests.

## 10. Acceptance criteria

- A new Thread defaults to Local Host and shows only its Workspaces and Agents.
- Switching Host changes both composer pickers and restores per-Host context.
- Cross-Host Workspace attachment is rejected by the domain.
- Missing or unauthenticated remote Agents block send with a concrete action.
- A remote task continues when Desktop exits and reconciles without duplicate
  messages, tool calls, or Artifacts after restart.
- A network loss does not mark a still-running remote Run failed.
- Switching Host does not affect an already running Attempt.
- Host restart uses a new generation and either resumes from an Agent checkpoint
  or marks the Run interrupted.
- Revocation prevents all new process, terminal input, and tool operations.
- A development container rebuild cannot accept commands from its old instance.


## Implemented Link identity and authorization invariants

Host public keys identify Hosts; serialized addresses are routing metadata. Exact
opaque Host resource IDs identify Workspaces; paths describe confinement roots.
Pairing proves device possession of the OTP, while device names remain self-reported
hints. Pair-link token rotation invalidates pending invitations without revoking
existing paired devices. Pending OTPs are ephemeral; device grants are durable.

Persist inventory independently of Thread bindings. Binding validates Host/resource
ownership and is idempotent for Thread, endpoint and resource. Unbinding preserves
inventory. Refresh reconciles removed resources and prunes stale bindings. Every
Host file/process call rechecks device/resource grants; ACP executable launch also
rechecks its Agent runtime grant. Client-side Rig profile policy is not yet a
cryptographic claim attached to every generic Workspace call.

Grant changes use clone/validate/atomic-persist/swap so persistence failures cannot
silently diverge memory and disk. Connection caches include routing and credential
configuration and invalidate stale entries. Resource identity, local authorization
schema and named wire capabilities are separate contracts; see
[Remote Control](remote-control-architecture.md) for current Link evolution.

The existing `RemoteEndpoint` still combines durable Host identity and transport
metadata. Split Host/connection/instance concerns before adding provisioning state.
Do not infer a durable disconnected Run supervisor from the current desktop-hosted
Agent process. Shared resource removal, Run leases and new Host providers retain
the implementation boundaries described above.
