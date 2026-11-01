# Agent harness and capabilities

The harness is the execution contract for one Attempt. A capability catalog is a
discovery and diagnostics projection, not an authorization system: advertised
availability does not establish credentials, reachability, grants or successful use.

## Ownership

Workflow schedules Attempts. `services/agent/src/harness.rs` owns discovery and
leases; `execution.rs` owns admission, approval, cancellation, deadlines and the
journal port; `runtime.rs` owns the model loop. Neutral contracts live in
`crates/ovule-agent-api`. Application modules under `src/agent_host` assemble scope,
providers, routing, ACP callbacks and authenticated Attempt MCP servers. Domain
services own implementations; drivers do not create a second task tree or store.
See [layering and discovery](agent-layering-and-discovery.md) for the dependency model.

| Capability | Lifetime and projection | Boundary |
| --- | --- | --- |
| Browser Use | Attempt-owned Explorer; Rig and local Attempt MCP | Document refs, HTTP(S) navigation and takeover checks |
| Computer Use | Physical desktop/session; Rig, authenticated MCP and ShellAPI | Native CRD input/capture; Local and Link routing, no pretend SSH desktop |
| Workspace | Selected binding and Attempt; provider and ACP callbacks | Scoped paths, processes and execution policy |
| Terminal | PTY run and native UI stream | Interactive PTY is separate from command execution |
| Skills | Agent selection and Attempt context | Metadata, explicit instruction activation, bounded resource reads |
| Memory | Thread and read-only Project scopes | Provenance, exact scope, revision/CAS, TTL and FTS5 keyword search |
| Workflow | Goal, Task, Attempt and Gate | Scheduling, retry, handoff and cancellation above the harness |
| Storage | Application repositories | Transactional checkpoints/events; no model SQL interface |
| Extensions/MCP | Package, connection and acquired lease | Discovery does not grant host authority |

`services/workspace/src/state/capabilities.rs` projects the catalog. Distinguish
capability kind, backend, owner, implemented projection and selected Agent route.
An item without an Agent projection must not enter the model's tool list.

## Context and execution

Acquire concurrency admission before allocating Browser leases or MCP servers.
Assembly receives explicit Thread, Project, Host, Workspace, driver and context
budgets. Local ACP uses a random bearer on a loopback MCP server. Remote ACP does
not have the same Host context channel; configurations requiring inaccessible local
Skills fail preflight. Do not silently read a same-named remote file.

Initial context includes Skill metadata, followed by explicit instruction/resource
reads. Planning does not read Skill files or grant context tools. Memory is queried
on demand rather than copied wholesale into the prompt. The context limit is
96,000 characters, not tokens; overflow fails before dispatch. Manifests record the
route, actual budget, revisions, scopes, projections and warnings.

Capability discovery initially exposes `ovule_capabilities`; search returns metadata
and load makes schemas available on the next request. Loading changes visibility,
not permission. Acquire MCP connections only when needed, isolate provider failures
and release leases on completion, cancellation or failed initialization.

Application projections share `ToolExecutor` admission, one-shot external-effect
approval, deadlines and body-free observations. The execution journal commits
intent before dispatch and settlement afterwards; unfinished records are not
replayed automatically. A timeout does not roll back side effects. External ACP
programs remain separately trusted: their own tools do not all pass through Ovule's
executor. See [execution permissions](agent-execution-permissions.md).

## Browser and Computer Use

Browser operations use isolated-world DOM refs and an expected document ID.
Takeover, navigation and surface transfer invalidate refs; fresh snapshots are
required. Input consumes its snapshot generation. Navigation permits HTTP(S)
without URL credentials. Arbitrary JavaScript is not a model tool. Each Attempt
owns an in-memory partition; closing its surface prevents reopening it implicitly.

An Explorer handle can move between overlay, sidebar, workbench and a window
without reloading the page. Transfers pause tools until the receiving surface
rebinds. Closing the owning surface or finishing the Attempt releases the resource.
A busy overlay fails explicitly; promoted surfaces may coexist.

Browser input is synthetic DOM input, not trusted OS input. Cross-origin iframe
interaction, native file pickers and anti-automation behavior need independent
validation. Computer Use uses native capture/input. Feedback is non-interactive
and respects reduced motion, but desktop-wide overlays and capture exclusion still
need Framework support. Visible Ovule feedback may appear in physical screenshots.

Images return typed media. Rig's per-result base64 image budget is 16 MiB; the
Browser JSON and external MCP limits remain separate. Local capture uses binary
Mojom bytes; remote snapshots retain Link frame limits. Continuous desktop media
uses WebRTC rather than JSON or React state.

## Skills and Memory

Skills share one parser between Settings and runtime discovery: at most 128 selected
items, 1 MiB per file, bounded YAML metadata and SHA-256 revisions. Resources are
UTF-8 text under the Skill root; reject traversal and escaping symlinks. Reading a
script does not execute it. The current API does not provide capability-directory
protection against concurrent filesystem replacement.

Memory uses a repository port and SQLite FTS5. Filter scopes before limiting search;
quote query terms instead of accepting arbitrary FTS expressions. Return metadata
and short snippets, then paginated bodies. Encoded context results are bounded to
15,000 characters; overflow requests a smaller limit instead of truncating JSON.
Writes require provenance and an expected revision. Deletion clears content/indexes
but retains a revision tombstone; TTL controls visibility, not secure erasure.
Project memory is read-only through this projection. There is no embedding search,
background consolidation, automatic transcript ingestion or global user profile.

## Extending a capability

Specify stable operation IDs, typed arguments/results/errors, payload limits,
resource ownership, policy, cancellation, concurrency, recovery and diagnostics.
Register projections only after adapters exist. Rig, ACP, MCP and ShellAPI should
call the same domain service. Keep pixels, PTY bytes and video on transports with
their own backpressure rather than forcing them into generic tool URLs.

Host declarations for Computer Use, handoff and Ollama live in
`crates/ovule-extension-api/src/host.json`. `io.ovule.host` is a reserved routing
owner, not an installable extension. Cloudflare, Office and visualizations retain
independent extension implementations.

## Evaluation

Run [harness evaluation](local-development.md#harness-evaluation) against fresh
source/packages. Deterministic contract runs, native scripted-provider runs and
real-model task success measure different things. Skips are not passes. Preserve
scope, restart, stale-ref, cancellation and trace-privacy checks when changing a
projection; do not treat a successful assistant answer as evidence the goal succeeded.
