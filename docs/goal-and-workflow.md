# Goal and dynamic workflow

## 1. Product model

This document uses two explicit Thread terms:

- **Conversation Thread** is the user-facing conversation that owns zero or
  more Goals. Each newly planned Workflow is embedded in the Agent reply that
  created it, using a persisted workflow Message Part.
- **Workflow Node Thread** is the independent conversation owned by one
  executed Task Node. It is created lazily when that Task starts an Agent
  attempt. Pending Nodes retain a durable execution context without creating
  empty Threads; approval Gates do not create Threads. It has its own Agent,
  Host, attached Workspaces, Messages, and
  Attempt history. It is opened from the Node and is not listed as a top-level
  Conversation Thread.

A Goal is the durable contract with the user. A Workflow is the current
execution strategy for satisfying that contract. The distinction is essential:
replanning, replacing an agent, or restarting a workflow must not erase the
outcome, constraints, evidence, or discussion attached to the goal.

```text
Goal: "Upgrade the service and keep all tests passing"
  intent
  acceptance criteria
  constraints and permission ceiling
  budget and deadline
  progress and evidence
  └─ Workflow run 1: investigate → migration tasks → verifier
       └─ superseded after a blocker
     Workflow run 2: revised tasks → verifier → completion proposal
```

The default user interaction is goal-first. A simple question may complete in
one agent turn without showing workflow machinery. A complex goal expands into
phases and parallel tasks as evidence accumulates.

The user-facing control surface is prompt-driven:

- `/goal <prompt>` asks the selected Conversation Thread Agent to create the
  Goal contract and its initial Workflow;
- `/goal #<goal_id> <prompt>` asks the Agent to revise that Goal and replace its
  remaining plan;
- the titlebar Goal form emits the same `/goal` command. It does not create an
  empty Goal or hand-author Nodes.

## 2. Goal contract

```rust
pub struct Goal {
    pub id: GoalId,
    pub thread_id: ThreadId,
    pub title: String,
    pub intent: String,
    pub criteria: Vec<Criterion>,
    pub constraints: Vec<Constraint>,
    pub budget: GoalBudget,
    pub status: GoalStatus,
    pub revision: u64,
}
```

The persisted representation also records creator, timestamps, active workflow,
parent goal when delegated, result summary, and artifact/evidence references.
Prompt text is not the state machine. All control fields are structured and
validated at the capability boundary.

### 2.1 Acceptance criteria

A criterion is observable and can hold evidence.

```text
Criterion
  id
  statement
  required: bool
  verification: automatic | agent | human
  state: pending | running | passed | failed | waived
  evidence[]: artifact, command result, diff, URL, user decision
```

The orchestrator may propose criteria during planning, but the user sees and can
edit them. It cannot silently remove or weaken a user-authored criterion. A
waiver requires an explicit actor and reason.

### 2.2 Constraints and permissions

Constraints cover allowed roots, forbidden operations, model preferences,
quality requirements, branch/worktree policy, channel visibility, and deadlines.
They form a ceiling: a workflow may narrow them for a child task but cannot
expand them. Tool permission remains independently enforced.

### 2.3 Budget

The first release tracks wall time, model tokens when reported, estimated model
cost, maximum concurrent tasks, and maximum spawned tasks. Budget thresholds
produce warning events; hard limits pause the goal and require approval. Missing
provider usage is shown as unknown rather than guessed.

## 3. Goal lifecycle

```text
draft
  └─ start → active
active
  ├─ pause → paused
  ├─ blocker → blocked
  ├─ propose completion → verifying
  ├─ cancel → cancelled
  └─ failure policy exhausted → failed
paused | blocked
  ├─ resume/resolve → active
  └─ cancel → cancelled
verifying
  ├─ criteria satisfied → completed
  ├─ evidence rejected → active
  └─ user sign-off required → awaiting_approval
awaiting_approval
  ├─ approve → completed
  └─ reject → active
```

Only the Goal capability changes this state. An agent requests transitions using
tools; it does not write state. Completion always passes through `verifying`,
which prevents a fluent final message from being mistaken for verified success.

## 4. Dynamic workflow model

Dynamic means the graph is extended during execution. It does not mean arbitrary
code executes inside the scheduler. Ovule begins with two node kinds:

- `task`: run an agent with a scoped objective, inputs, working mode, output
  schema, and completion policy;
- `gate`: wait for a user decision or external condition.

Dependencies provide joins. A verification task is an ordinary task with a
verifier role. Conditions and loops are decisions made in orchestrator rounds,
not additional node types. This keeps the scheduler small.

```rust
pub struct Node {
    pub id: NodeId,
    pub goal_id: GoalId,
    pub thread_id: ThreadId, // dedicated Workflow Node Thread
    pub phase: String,
    pub depends_on: Vec<NodeId>,
    pub kind: NodeKind,
}

pub enum NodeKind {
    Task(Task),
    Gate(Gate),
}

pub struct Task {
    pub title: String,
    pub objective: String,
    pub agent: AgentSelector,
    pub workspaces: WorkspaceSelection,
    pub output_schema: Option<SchemaRef>,
    pub retry: RetryPolicy,
}

pub struct WorkspaceSelection {
    pub primary: WorkspaceSelector,
    pub attached: Vec<WorkspaceSelector>,
    pub isolation: IsolationMode,
}

pub struct Gate {
    pub prompt: String,
    pub expires_at: Option<Timestamp>,
}
```

`AgentSelector` initially supports Conversation Thread default, explicit `codex`, `claude`,
`sample`, or `ovule`, and capability selectors such as `browser`. Delegating a
Task resolves the selector and creates an Attempt containing the concrete Agent
ID.

`WorkspaceSelection` resolves against the inventory of the selected Host. The
Node's Workflow Node Thread persists the resolved Host, Agent profile, and
Workspace resource IDs before dispatch. One primary Workspace owns relative cwd,
Git review, and default writes;
attached Workspaces are read-only unless the Task receives an explicit write
grant. Work spanning multiple remote endpoints should normally be decomposed into
dependent Tasks so each Attempt has one execution location and an auditable
capability set.

The planning Agent receives a bounded inventory of Host IDs, Agent profile IDs,
and Workspace resource IDs. A structured Node assignment may select a Remote
Host only with IDs from that inventory. Missing assignments inherit the parent
Conversation Thread. Dispatch always reads the Workflow Node Thread context,
never the parent's current selection, so later UI changes cannot move an
already planned Node to another Host.

Workflow Task output is a normal user/assistant message pair in its Workflow
Node Thread. The parent Conversation Thread renders only the Workflow card and
bounded per-Node activity summaries; the full transcript is opened by clicking
the Node. Multiple Workflow cards are ordered with Messages by creation time.

The graph is append-oriented. Nodes that have started are immutable. Replanning
marks pending, waiting, failed, cancelled, blocked, or rejected Nodes as
`superseded` and appends replacement Nodes with fresh Workflow Node Threads.
Succeeded, approved, running, and cancelling Nodes retain their original
execution context and transcript, preserving a truthful history. Compact cards
omit superseded Nodes; the full Workflow view retains them as audit history.

## 5. Orchestrator rounds

The Goal driver invokes an orchestrator when a Goal starts, a Task succeeds or
fails, a Gate resolves, a blocker changes, or the user sends `/goal #<goal_id>`.
Each round reads
a bounded projection rather than the full raw transcript:

- goal contract and current revision;
- criteria and evidence;
- current graph and task summaries;
- blockers and approvals;
- budget usage;
- user steering messages;
- relevant artifacts selected by the context builder.

The MVP orchestrator returns a validated structured replacement for the
remaining plan. The durable model applies that replacement atomically while
preserving immutable execution history. The longer-term typed control surface
is:

```text
workflow.add_nodes(nodes: Node[])
workflow.supersede(task_ids[], reason)
goal.update_progress(summary)
goal.add_evidence(criterion_id, evidence)
goal.report_blocker(blocker)
goal.propose_completion(summary)
goal.fail(reason)
```

One tool transaction validates the expected goal/workflow revision and appends
events atomically. A stale orchestrator round is rejected and rerun against the
new projection. This is enough concurrency control for a single daemon.

The orchestrator is selected through the Agent registry. It may be
`OvuleAgent` backed by community Rig or an external harness connected through
ACP, a structured CLI protocol, or Ovule workflow tools exposed through the
official MCP Rust SDK. The workflow state model does not depend on a specific
harness.

## 6. Scheduler

The scheduler is a deterministic local queue, not a general workflow engine.
It repeatedly:

1. selects pending tasks whose dependencies succeeded and whose goal is active;
2. orders them by phase order, explicit priority, then creation sequence;
3. applies global, goal, Agent, and workspace concurrency limits;
4. asks Workflow to delegate the Task, which creates `attempt/created` with a
   concrete Agent;
5. dispatches the ready Attempt, producing `attempt/dispatched`;
6. the AgentDriver starts a WorkerHandle, producing `attempt/started`;
7. records terminal Attempt state;
8. requests another orchestrator round when the graph has no immediately ready
   work or new evidence may change the plan.

Independent tasks may run concurrently. Two write tasks do not share a mutable
working tree by default: the workspace capability creates isolated git worktrees
when possible. Read-only tasks may share the source tree. Merge/reconciliation is
an explicit task visible to the user.

Structured Goal derivation expresses this DAG explicitly. Every returned Node
has a response-local `id` and a `dependsOn` array referencing only earlier Node
IDs. Multiple Nodes with the same dependency depth form one parallel scheduler
wave; a Node with multiple dependencies is a visible join. For compatibility,
an omitted `dependsOn` is interpreted as depending on the immediately previous
Node, preserving the historical sequential plan.

## 7. Attempts and retry

Every Task execution creates an Attempt with start event, Agent identity, input
hash, output references, usage, and terminal outcome. A retry creates a new
attempt; it never rewrites history.

```text
created → dispatched → started → running
running → waiting_permission → running
running → succeeded | failed | cancelled | abandoned
```

Automatic retry is limited to failures known to have no external side effect,
such as a provider request rejected before execution. An interrupted shell
command, browser form submission, or ambiguous CLI crash is not replayed
automatically. The orchestrator receives the ambiguity as evidence and decides
whether to inspect, retry, or request approval.

## 8. Agent execution

The Agent registry exposes one normalized operation to Workflow:

```rust
async fn execute_attempt(
    scope: AttemptScope,
    request: ExecuteTaskRequest,
    sink: ExecutionEventSink,
) -> AttemptOutcome;
```

`OvuleAgent` uses `OvuleDriver`, backed by the community `rig-core` runtime
after its integration
spike passes; Ovule supplies scoped tools and event mapping but does not
implement another generic model loop. External AgentDrivers launch complete tools
such as Claude Code, Codex, dsh, or
other local agents. ACP or another structured protocol is preferred; PTY is the
fallback. Their native memory, hooks, skills, MCP, plans, and approval behavior
remain intact.

Onboarding recommends an already authenticated compatible harness when it has the
required capabilities. Otherwise it offers `OvuleAgent` with guided
provider credential or local endpoint setup.

## 9. Goal rounds

Some goals cannot be planned to completion in one workflow graph. The Goal
driver therefore supports rounds under the same Goal:

```text
round 1: discover and propose
round 2: execute selected approach
round 3: verify and repair
```

A round is not another scheduler. It is a durable reason for invoking the
orchestrator again. The driver stops when the goal is terminal, paused, waiting
for a gate, out of budget, or has no new evidence and no progress. Two
consecutive no-progress rounds pause with a blocker instead of looping forever.

## 10. User steering

User input during a run is never injected into arbitrary worker stdin. It is
recorded as goal steering and handled according to scope:

- `clarify`: adds context without cancelling current safe work;
- `change`: pauses new scheduling, supersedes affected pending tasks, and runs
  the orchestrator;
- `stop`: cancels the goal and active attempts;
- `answer`: resolves a specific gate;
- `terminal input`: explicitly targets a selected Agent's WorkerHandle.

Desktop and channel messages use the same command and revision checks.

## 11. Saved workflows

The first authoring format is readable Markdown with YAML frontmatter. It is a
prompt/profile template, not an executable DSL.

```markdown
---
name: review-change
description: Review changed files and verify actionable findings
orchestrator: default
size: medium
required_capabilities: [git, shell.readonly]
approval: before_write
---

Discover changed files, review independent files in parallel, then use a
separate verifier to deduplicate and challenge the findings. Attach the final
report as `review.md`.

## Acceptance criteria

- Every changed source file is considered.
- Each reported issue cites file and line evidence.
- A verifier rejects speculative findings.
```

The model generates tasks through typed tools at runtime. This supplies the
useful behavior of dynamic workflows without a JavaScript sandbox in the core.

A later compatibility extension may execute Claude-style `agent()`, `parallel()`,
and `pipeline()` JavaScript in an isolated process. It must compile calls into
the same Workflow capability and cannot access the filesystem or network
directly.

## 12. Recovery

On daemon restart:

1. running attempts become `abandoned`;
2. external process discovery checks whether known native recovery state can be safely
   reattached;
3. safe queued tasks return to pending;
4. ambiguous attempts remain visible and require orchestrator or user action;
5. active goals resume only after store and adapter readiness;
6. channel outbox delivery resumes independently.

Completed Task results are reused when their definition, inputs, Agent/driver
profile, workspace revision, and required artifact hashes match. Reuse is an
optimization with visible provenance, not a hidden exactly-once claim.

## 13. Minimum acceptance tests

- A one-task goal completes without exposing an empty workflow graph.
- An orchestrator adds parallel tasks after discovering work at runtime.
- A stale graph mutation cannot overwrite user steering.
- A failed task can trigger a revised task without deleting history.
- Goal completion is rejected while a required criterion lacks evidence.
- Pausing prevents new scheduling and preserves running-task policy.
- Restart marks ambiguous attempts and resumes safe pending work.
- Rig, ACP, structured-CLI, and PTY AgentDrivers pass the same normalized Task/
  Attempt contract tests for the capabilities they advertise.
- A saved Markdown workflow produces the same behavior in desktop and Channel.

## Conversation and interactive UI contract

The Workflow Message Part persists the association with its creating Agent reply.
Each Goal's graph stays in the creating Agent message in the parent Thread, including
while active. A separate activity window sits 16 px below the header and 16 px from
the right edge. It shows scoped Agent activity, waiting reasons and concise action
rows, without embedding another graph or raw result Markdown. Users can drag the
window, dismiss its body, restore it and open the Workflow tab. The tab combines the
a flat graph without a repeated title, activities and an expandable node inventory
in one vertical scrolling surface.
Setup blocks render in the first Task's Node Thread; the Workflow part persists its
setup Node ID so the activity window can provide an Open configuration action.
Within a reply, a host-owned Channel setup card supersedes model-authored copies.
Only executed Tasks create Node Threads. Their artifact tabs and preview entries
are siblings of Node Threads directly below the parent Conversation Thread, without
another Sidebar nesting level. Icons retain fixed dimensions when titles truncate.
Browser requests from message cards open an Explorer overlay; moving the preview
to a tab preserves the live browser session.

Successful Tasks and approved Gates advance the existing dependency graph without
calling the planner again. Failures and rejected Gates may request a replacement
plan, with at most two automatic recovery rounds since the latest explicit Goal
adjustment. Ready Gates publish their state even if no Tasks become ready. Pairing is
not end-to-end completion: inbound delivery, Agent execution and durable reply
must still be verified. Planning is a tool-free JSON completion; execution retains
tools with bounded recent history and explicitly truncated large tool output.
The read-only channel status tool exposes connection-scoped live setup facts;
selected Skill text is embedded within a bounded execution prompt budget.

Long Agent Markdown defaults to a short preview with expandable details. The
execution prompt asks for concise conclusions and available interactive blocks.
The composer recognizes installed Skill commands as clickable links. `skill:<id>`
opens registered, enabled Skill Markdown read-only; it does not grant arbitrary
filesystem access or allow changes to installed Skills. Goal creation remains
available through `/goal`, without a duplicate titlebar action.

Planning prompts prefer 1–6 initial Nodes. Validation accepts up to 64 Nodes so
useful verification and approval steps do not invalidate a plan. Dependency,
identity, execution-target, and payload validation still apply; plans are never
silently truncated. Pending execution contexts survive save/restart.

The `interactive-ui` contribution in the visuals extension accepts
`{ title, html }` in the usual `ovule-block` envelope. The host iframe renderer
creates an opaque-origin iframe with `sandbox="allow-scripts"`. Generated HTML,
CSS, and inline script tags execute there using the host CSP script nonce.
Event listeners use `addEventListener`; inline event attributes and external
scripts are removed. The main application CSP stays unchanged; CSP restricts resource loading,
connections, forms, and base URLs. The iframe receives no host APIs, credentials,
or extension-action capability. Its `window.ovule.compose(prompt)` bridge only
fills the user composer; the user reviews and sends the next message. Messages
are accepted only from the current frame and bounded to 16 KiB. The HTML payload
is bounded to 128 KiB. This is a generic UI surface for calculators, forms,
comparisons, and choice cards, rather than executable application plugins.

This separation follows the publicly documented iframe/component approach in
[OpenAI Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui), without
assuming anything about the implementation of model-native ChatGPT interfaces.

Composer suggestion chips appear only in an empty Conversation Thread. Slash
command completion remains available in existing conversations and Node Threads.

### Interactive UI isolation

A trusted extension Web Component owns the card lifecycle, sizing, and application
bridge. Generated HTML and JavaScript run in a separate sandboxed iframe: Shadow
DOM encapsulates presentation but does not isolate JavaScript from the application.
Trusted, shipped extension controls may render directly as Web Components; arbitrary
Agent-generated programs must keep the iframe boundary.

The iframe uses `allow-scripts` without `allow-same-origin`, so its document cannot
read application DOM, credentials, or ShellAPI. Its document CSP restricts resources
and network access. A `srcdoc` document inherits the embedding policy; its own CSP
can further restrict it but cannot relax that inherited policy. Do not broaden the
application CSP to accommodate generated cards. A future separately hosted card
renderer could own a separate response CSP while retaining sandbox isolation and
an explicit, validated message bridge.

The policy inheritance behavior is specified in [CSP Level 3](https://www.w3.org/TR/CSP3/#csp-inheriting-to-avoid-bypasses).
