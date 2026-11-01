# Agents and threads

Public examples use a synthetic ACP adapter (`sample`); it is a test fixture. Install real external adapters explicitly from their own repositories.

## 1. Purpose

`Agent` is the product-level actor to which a Workflow delegates a Task. Codex,
Claude, Sample ACP, DeepSeek, and Ovule are Agents. Every orchestrated Agent exposes
ACP; Ovule is the ACP Client and uses the official Rust SDK. Agent launch metadata
is catalog data, not a vendor-specific protocol extension point.

`Thread` is the stable conversation shared by desktop and channels. A Thread
belongs to one Project, binds one or more local/SSH/Tunnel Workspaces, and contains
Goals, Artifacts, and user-visible turns. Different Agents do not share one
private model context. Agent-native session IDs are private
recovery metadata. A cross-Agent Task receives an explicit handoff
artifact.

## 2. Canonical hierarchy

```text
Project
  Thread
    WorkspaceBinding 1..m
    Goal
      Workflow
        Node
          Task
            Attempt
              Agent (reference)
          Gate
    Artifact 0..n
    ChannelBinding 0..n
```

- `Goal`: the desired outcome, constraints, budget, criteria, and evidence.
- `Workflow`: the current dynamic execution strategy for a Goal.
- `Node`: the graph identity and dependency boundary.
- `Task`: an executable Node with objective, inputs, primary/attached Workspace
  selection, isolation mode, output
  contract, and Agent selector.
- `Gate`: a non-executable Node waiting for a user decision or external condition.
- `Attempt`: one immutable execution of a Task. Retry creates another Attempt.
- `Agent`: the actor referenced by the Attempt as responsible for execution; the
  Attempt does not own the Agent.

Project, Thread, WorkspaceBinding, Artifact, and ChannelBinding are product objects
outside the workflow hierarchy. Native Agent conversation state belongs to the
selected ACP Agent and is referenced from Attempt metadata, not exposed as another
public domain layer. Endpoint identity is reusable infrastructure; each
WorkspaceBinding remains owned by exactly one Thread.

## 3. Agent and ACP session contract

```rust
pub struct Agent {
    pub id: AgentId,
    pub launch: AcpLaunchDescriptor,
    pub profile: AgentProfile,
}

#[async_trait]
pub trait AgentSessionService: Send + Sync {
    async fn probe(&self, agent: &Agent, target: &ExecutionTarget) -> ProbeResult;
    async fn start(
        &self,
        scope: AttemptScope,
        request: StartAcpSessionRequest,
        events: ExecutionEventSink,
    ) -> Result<Box<dyn AcpSessionHandle>>;
}

#[async_trait]
pub trait AcpSessionHandle: Send {
    fn capabilities(&self) -> AgentCapabilities;
    async fn interrupt(&mut self) -> Result<InterruptResult>;
    async fn terminal(&mut self) -> Option<TerminalHandle>;
    async fn wait(self: Box<Self>) -> AttemptOutcome;
}
```

`start` returns after the ACP session is initialized. Completion is reported by
the handle and normalized ACP session updates. SDK wire types remain in the ACP
adapter; queues and output buffers are bounded.

Resume/fork is not another workflow concept. An ACP Agent may use private
`NativeSessionState` recorded on earlier Attempts when capability probing and
version checks show that reuse is safe.

## 4. Task selection

Each Task contains `AgentSelector`:

```text
thread-default
agent:codex
agent:claude
agent:sample
agent:deepseek
agent:ovule
capability:browser
capability:structured-output
```

At Attempt creation, the Workflow scheduler resolves the selector against the
current Agent registry and records the concrete Agent ID, ACP implementation version,
profile, `AttemptExecutionContext`, Workspace revisions, and capability snapshot.
Later configuration changes do not
mutate a running Attempt.

The vocabulary is intentionally precise:

```text
Workflow delegates Task to Agent
  -> creates Attempt with Agent ID (`attempt/created`)
Scheduler dispatches ready Attempt
  -> invokes AgentSessionService (`attempt/dispatched`)
AgentSessionService starts ACP session
  -> Worker executes (`attempt/started` ... terminal Attempt event)
```

`delegate` is a Workflow operation, not a service or stored object. `dispatch` is
the scheduler mechanism. `Agent` is the product actor; ACP session and process
handles are implementation details.

A thread has a default Agent for newly created single-task workflows. Users
can change it between turns with `/use codex|claude|sample|ovule` or the desktop
picker. An active Attempt is never silently moved; interrupt and re-execution
produce a new Attempt.

## 5. Normalized execution events

ACP sessions are projected into portable observations:

```text
agent/probed                executable/version/readiness/capabilities
attempt/created             delegated Task and selected Agent snapshot
attempt/dispatched          scheduler invoked AgentSessionService
attempt/started             ACP session and native execution generation
output/delta                transient text or safe reasoning summary
message/completed           durable assistant message
tool/started, tool/finished safe tool name, status, and references
permission/requested        native or Ovule approval request
plan/updated                structured plan when supplied
usage/updated               provider-reported usage when supplied
terminal/available          attachable terminal identity
attempt/completed, attempt/failed terminal outcome
worker/exited               process exit and safe-resume metadata
```

Missing plan, usage, fork, terminal, or tool detail remains absent. Ovule does
not fabricate it from screen text. Bounded raw vendor events may be retained as
desktop-only diagnostic artifacts.

## 6. Agent catalog

| Agent | Runtime | Configuration owner | Required integration |
| --- | --- | --- | --- |
| `CodexAgent` | external process | Codex auth/model/native config | official or maintained ACP server |
| `ClaudeAgent` | external process | Claude auth/model/native config | official or maintained ACP server |
| `external ACP Agent` | external process | Sample ACP auth/model/native config | official or maintained ACP server |
| `OvuleAgent` | embedded Rig runtime | Ovule model/tool/skill policy | built-in ACP Agent implementation |

The current launch mapping is intentionally explicit: `sample acp serve`,
`codex-acp`, and `claude-agent-acp`. Codex ACP and Claude Agent ACP are installed
as fixed-version private Toolchains with lockfile integrity verification. A
Ovule profile backed by OpenAI reuses Codex ACP; DeepSeek and Ollama profiles
run through the in-process Rig ACP server.

Each ACP `session/new` carries the primary Workspace as `cwd`, same-endpoint
secondary roots as `additionalDirectories`, and selected MCP servers. Ovule's
ACP Client implements bounded `fs/read_text_file` and `fs/write_text_file` over
the binding's Local, SSH, or Link transport. The built-in Rig Agent additionally
receives explicit list/read/write/exec tools keyed by `WorkspaceBinding` ID, so it
never treats a remote path as a local filesystem path.

For SSH and Ovule Link bindings, executable and MCP process availability is
decided by the execution Host. The Client still validates enabled Agent, Model,
Skill, and Tool references, but its local installation health is informational
and cannot block selecting or starting a remotely hosted Agent. Local Workspace
execution continues to fail before launch when its required ACP server or Tool is
missing.

DeepSeek, OpenAI-compatible endpoints, Ollama, and other model providers are model
choices for `OvuleAgent`, not separate Agent protocol implementations. An
external Agent without ACP remains usable in a normal Terminal but is unavailable
to Workflow. Unsupported ACP versions are unavailable rather than routed through
private stdout or app-server parsers.

Each Task Attempt owns a durable `output` buffer and monotonic `outputSequence`.
The Rust host commits a delta before emitting `ovule:agent-output`; the UI
applies only the expected sequence and reloads the authoritative SQLite snapshot
on a missing Attempt or sequence gap. Conversation Attempts also mirror this
buffer to their assistant Message. Workflow Attempts deliberately do not create a
chat Message: the live Workflow card renders the Attempt buffer as streaming
Markdown, and the completed Attempt card renders the same persisted content.

## 7. Cross-Agent handoff

When a dependent Task selects another Agent, the Workflow creates a bounded
handoff artifact containing:

- Goal and criteria served;
- Task objective, constraints, and output contract;
- relevant user turns;
- completed Task summaries and evidence;
- selected files/artifacts;
- blockers, approvals, workspace/worktree revision.

The target Agent receives the handoff and allowed workspace access. Ovule
does not copy unrelated transcript or private reasoning. The artifact hash is
recorded on the Attempt, making the handoff inspectable and reproducible.

## 8. Thread and channel routing

```text
(channel_connection_id, external_conversation_id, external_thread_id?)
  -> ThreadId
```

Desktop and channel inputs append to the same Thread inbox. The daemon accepts
each message once and either creates/steers a Goal or creates an implicit
single-Task Workflow using the thread-default Agent. Channel adapters never call
AgentSessionService directly.

For direct messages without topics, a conversation continues one Thread until
`/new`. A platform topic maps to one Thread. Group root messages create work only
under mention/allowlist policy.

## 9. Required product contract

- discover and probe ACP Agents and their capabilities;
- create a Task and immutable Attempt execution context;
- select one primary and zero or more attached Thread Workspaces;
- stream normalized output and terminal updates;
- bridge permissions and Human handoff;
- interrupt and support resume/fork only when negotiated;
- record final response/failure and native session metadata;
- switch thread-default Agent between turns.

Browser, Markdown, and Terminal are native tools of `OvuleAgent` and may also
be exposed to compatible external Agents through scoped MCP/ACP capabilities.

## 10. Failure rules

- Ambiguous input delivery is never retried automatically.
- Native session metadata is reused only after capability/version validation.
- ACP protocol failure retains bounded redacted diagnostics and marks the Agent unavailable.
- Worker failure fails or abandons the Attempt, not the Thread or Goal.
- Agent or ACP SDK upgrades cannot silently reuse incompatible native state.
- Ovule policy only restricts native permissions; it never silently bypasses
  them.

## 11. Acceptance tests

- The same Thread completes one Task/Attempt with all four Agents.
- Switching Agent affects only future Attempts.
- Desktop and Channel append to the same ordered Thread.
- Workflow selects Agent by ID and capability.
- Cross-Agent handoff excludes unrelated transcript and secrets.
- Flood, parser failure, cancellation, crash, and unsupported version are bounded
  and observable.
- Sample ACP coverage includes a live initialize handshake through the same local
  process transport used by the application; Local, SSH, and Link transports
  each have bidirectional process-stream tests.
