# Observability

## 1. Principle

Every goal must answer five questions without reading raw logs:

1. What outcome is being pursued?
2. What is running now, and why?
3. What changed since the last user interaction?
4. What is blocked, risky, or waiting for approval?
5. What evidence supports completion?

Observability is a product contract shared by desktop, Channel, headless output,
diagnostics, and tests. It is built from durable semantic events plus ephemeral
live deltas.

## 2. Durable event envelope

```rust
pub struct ThreadEvent {
    pub id: EventId,
    pub thread_id: ThreadId,
    pub sequence: u64,
    pub occurred_at: Timestamp,
    pub kind: EventKind,
    pub scope: EventScope,
    pub correlation_id: CorrelationId,
    pub causation_id: Option<EventId>,
    pub actor: Actor,
    pub visibility: Visibility,
    pub redaction: RedactionClass,
    pub payload_version: u16,
    pub payload: Vec<u8>,
}
```

Sequence is monotonic within a thread. Event IDs provide global uniqueness; UI
cursors use `(thread_id, sequence)`. Timestamps are display and diagnostic data,
not ordering authority.

### Scope

An event may reference workspace, thread, native execution generation, turn,
goal, workflow, node, attempt,
tool call, artifact, channel delivery, and trace IDs. Missing lower-level IDs
mean the event applies to the enclosing scope.

### Actor

Actors are user, agent, system, channel principal, scheduler, or tool. External
identifiers are stored in channel binding records and represented in events by a
local principal ID.

### Visibility

- `user`: safe for desktop and authorized channel delivery;
- `desktop`: may contain local paths or detailed diagnostics;
- `diagnostic`: hidden unless diagnostics are enabled;
- `secret`: never serialized to normal event consumers.

## 3. Event vocabulary

Event names are stable nouns and past-tense transitions. Representative groups:

| Group | Events |
| --- | --- |
| Thread | `thread/created`, `thread/message-added`, `thread/title-changed` |
| Agent | `agent/probed`, `worker/exited`, `handoff/created` |
| Goal | `goal/created`, `goal/started`, `goal/progressed`, `goal/blocked`, `goal/completion-proposed`, `goal/completed` |
| Workflow | `workflow/started`, `workflow/phase-entered`, `workflow/nodes-added`, `workflow/replanned`, `workflow/finished` |
| Attempt | `attempt/created`, `attempt/dispatched`, `attempt/started`, `attempt/output-appended`, `attempt/succeeded`, `attempt/failed`, `attempt/abandoned` |
| Tool | `tool/requested`, `tool/approval-requested`, `tool/started`, `tool/finished` |
| Criteria | `criterion/verification-started`, `criterion/passed`, `criterion/failed`, `criterion/waived` |
| Artifact | `artifact/created`, `artifact/revised`, `artifact/attached` |
| Channel | `channel/message-received`, `delivery/queued`, `delivery/sent`, `delivery/failed` |
| Runtime | `runtime/started`, `agent/degraded`, `budget/threshold-reached` |

Event payloads are versioned per kind. Renaming UI labels does not rename event
types. The first release does not expose a public extension event compatibility
guarantee, but migration tests must read every released local database version.

## 4. Live deltas and artifacts

Token deltas, terminal cells, progress spinners, and rapidly changing card text
are too frequent for one durable event each. The producer sends ephemeral
`LiveDelta` messages keyed by attempt and stream. A chunker periodically stores
compressed output in an artifact and appends one durable
`attempt/output-appended` event referencing byte/line ranges.

Suggested defaults:

- UI delta batch: 50 ms or 16 KiB;
- durable output chunk: 256 KiB or 2 seconds;
- channel projection update: 750 ms minimum, adjusted for platform limits;
- terminal scrollback retained separately from the semantic final response.

On reconnect, the UI reloads durable chunks and then resumes live deltas from
the current stream generation. It never relies on an unacknowledged delta as
durable history.

## 5. Projections

Projections are disposable read models. The minimum set is:

- `ThreadView`: title, workspace, latest activity, unread state, channel bindings,
  default Agent, Agent/Worker health and recovery state, and queued turns;
- `GoalView`: contract, status, progress, criteria, budget, blocker;
- `WorkflowView`: phases, task dependencies, task/attempt states;
- `TimelineView`: user-safe chronological cards;
- `ApprovalInbox`: unresolved gates and tool permissions;
- `ArtifactIndex`: type, producer, path/display name, revision, previewability;
- `ChannelStatus`: connection health and pending delivery count.

Each projection has the last applied sequence. A diagnostic rebuild command
drops and recreates projections from events while leaving configuration and
artifacts intact.

## 6. Trace model

Every goal receives a trace ID. Orchestrator rounds, task attempts, model
requests, tool calls, IPC commands, and channel deliveries create spans with
parent links. Trace fields include duration, queue time, outcome, model/Agent,
token counts when known, input/output byte counts, and retry reason.

The runtime uses `tracing` internally. A lightweight subscriber writes rotating
structured logs and derives metrics. OpenTelemetry export is an optional extension,
not a core dependency or a requirement for local use.

## 7. User-facing observability

### Goal header

Always shows status, concise progress, current phase, elapsed time, estimated
cost when known, active worker count, and the strongest blocker/approval.

### Phase strip

Normal mode shows phases as compact states: pending, active, completed, blocked,
or superseded. It does not expose an implementation graph unless expanded.

### Workflow inspector

Expanded mode shows Task dependencies, Agent, Attempts, duration, inputs,
outputs, and causation. Replanning leaves superseded tasks visible but dimmed.

### Timeline

The primary timeline combines user messages, assistant summaries, plans,
approvals, key tool results, artifacts, blockers, and completion evidence. Raw
stdout is collapsed behind attempt detail.

### Why panel

Every running or queued task can answer:

- which goal criterion it serves;
- which orchestrator round created it;
- which dependencies it waits for;
- which permission and workspace mode it has;
- what completion signal is expected.

## 8. Channel projection

Channel consumes the same Goal and Workflow projections but presents less detail.
A streaming card contains goal status, current phase, active/completed task
counts, latest safe summary, budget warning, and buttons for open, pause/stop, or
approval. Diagnostic events, raw tool input, local absolute paths, terminal
escape output, and desktop-only artifacts are excluded.

The final card includes acceptance criteria and evidence summaries. A user can
open the desktop at the exact goal/event cursor for full detail.

## 9. Metrics

Local metrics are derived, not separately authored by business code:

- goals active/completed/failed/blocked;
- goal time-to-first-action and time-to-completion;
- task queue and execution latency;
- Agent/driver success, crash, resume, and unsupported rates;
- tool approval wait time and denial rate;
- token/cost usage when reported;
- IPC reconnects and dropped ephemeral deltas;
- channel receive, send, retry, and outbox age;
- artifact and database size.

No telemetry leaves the machine by default. Export requires explicit opt-in and
uses the redacted metric/trace projection, never raw prompts or artifacts.

## 10. Redaction

Redaction occurs before persistence and before delivery, not only in the UI.
The event boundary removes known credentials, daemon tokens, provider keys,
authorization headers, and secret environment values. Tool definitions identify
sensitive input fields. Paths may be reduced to workspace-relative form for
user-visible events.

Because arbitrary command output can contain secrets, raw output artifacts are
desktop-only by default and are never copied into Channel. Users may explicitly
share a selected excerpt after seeing a preview.

## 11. Retention

Default retention is user-configurable and conservative:

- goal/thread semantic events: retained until the thread is deleted;
- live output chunks: compact after 30 days unless pinned;
- terminal scrollback: size-capped per attempt;
- orphaned temporary previews: removed when their lease expires;
- diagnostic logs: rotating size and age limits;
- channel deduplication keys: retained past the platform retry window.

Deleting a workspace binding does not delete source files. Deleting a Thread
shows the exact local database records and artifact directories affected and uses
a recoverable trash period when practical.

## 12. Diagnostics

The diagnostics view and `ovule doctor` report:

- host/UI/extension versions and protocol compatibility;
- mounted profile and capability-provider health;
- database integrity and projection cursors;
- harness adapter discovery/probe results;
- active child processes and cancellation state;
- optional local activation/GIPS endpoint and reconnect counts;
- Tuffite/Chromium version;
- Channel connection and outbox state;
- redacted recent errors.

An export bundle is previewed before writing and excludes credentials, prompts,
raw output, artifacts, and source code unless the user individually opts them in.

## 13. Acceptance tests

- Replaying events produces the same Goal and Workflow projections.
- UI reconnect after missed events yields a consistent revision.
- High-rate output does not create one SQLite row per token.
- A Channel card never receives a desktop-only event or absolute private path.
- Trace causation connects an inbound message to goal, task, model, tool, and
  delivery spans.
- Redaction fixtures cover provider keys, authorization headers, URL tokens, and
  configured secret environment values.
- A multi-hour run stays within configured database, memory, and scrollback
  limits.

