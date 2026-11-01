# Desktop product and UI

Implementation note (2026-09-10): the workbench now follows `layout.svg` with
an application-drawn cross-platform title bar, a two-column default layout,
and a hidden-on-start dynamic workbench panel. Browser Use requests reveal and
focus the `<explorer>` tab, while each Terminal tab owns independent UI state.
The two column separators support pointer and keyboard resize with persisted
widths; fixed-width workbench tabs scroll horizontally and reveal the active
tab. Three theme modes, Thread/Goal/Workflow timeline, catalog panels, static
`<explorer>` local HTML preview, Milkdown WYSIWYG, and bounded one-shot xterm.js
Terminal are implemented. Preview leases, source/split Markdown modes, conflict
detection, persistent PTY takeover, and Browser Use snapshot/action automation
remain target design; see `README.md`.

## 1. Product direction

The desktop should be a focused agent workbench: project and thread navigation
on the left, the active goal conversation in the center, and contextual changes,
terminal, workflow, or artifact detail on the right. The Codex reference is the
information architecture—projects, independent threads, local/worktree modes,
reviewable changes, and compact agent progress—not a pixel-for-pixel clone.

The UI stack is React, shadcn/ui, Tailwind CSS, Zustand, Vite, and Bun. Bun is a
development/build dependency only; packaged users do not install a JavaScript
runtime.

The implementation keeps `App` as a small composition root. Workspace lifecycle,
navigation, layout, projection, and form drafts are split into feature hooks.
Three narrow Zustand stores own backend runtime state, Thread/Goal selection,
and persisted workbench UI state; components subscribe through shallow selectors
instead of a monolithic workspace controller. Component styles are colocated,
with CSS Modules preferred for shell/titlebar/workbench/Terminal boundaries and
Tailwind utilities used for simple layout. Global CSS is limited to tokens,
reset, shared primitives, and intentional cross-renderer Markdown/workflow
contracts. Prettier is a required Web-source check.

The interface supports system-detected Chinese or English plus explicit
Chinese/English selection. Only product chrome is translated; user content,
workspace paths, model/Agent identifiers, and runtime diagnostics remain in
their source language.

## 2. Main workbench

```text
┌─ Ovule · new/sidebar ───── active Thread ───── controls ──────────┐
├────────────────┬────────────────────────────────┬─────────────────────┤
│ Project        │ Thread / Goal                  │ Workbench on demand │
│  └─ Thread     │                                │                     │
│      └─ Artifact│ Goal header + phase strip     │ Changes             │
│      └─ Artifact│                               │ Workflow            │
│  └─ Thread     │ Conversation timeline          │ Terminal            │
│ Project        │ approvals / artifacts / output │ Artifact preview    │
│  └─ Thread     │ Composer + Workspaces          │ Diagnostics         │
└────────────────┴────────────────────────────────┴─────────────────────┘
```

The workbench panel is absent on startup, not an empty reserved column. Opening
Workflow, Browser, Markdown, SPICE, or Terminal expands it. Manage covers the
complete framework left panel (Chat Sidebar plus Workspace) and never becomes a
Workbench tab. It defaults to Connected apps; Hosts is a section in its Sidebar.
The Workbench tab strip works like a compact browser:
Browser/Markdown/Workflow/SPICE reuse their existing tab, while every New
Terminal command creates another independent tab. Closing
the last tab collapses the panel. Inactive ordinary tool views remain mounted
so a WYSIWYG editor or terminal does not lose state while switching tabs or
temporarily hiding the rail. A Browser tab retains its URL and navigation state,
but releases and reattaches its native `<explorer>` while hidden; this avoids
retaining an inner WebContents whose compositor surface became invalid under
`display:none`. On narrow windows it becomes a lower panel. The conversation
remains the primary surface; users should not need to understand a DAG to ask
for normal work.

The 40 px application-drawn title bar uses the same layout on Windows and macOS.
The left reserve contains only the Ovule wordmark in place of the macOS traffic-
light area. Open setup, Manage, and Show workbench form a right-aligned group
immediately before the window controls.
They use 28 × 28 rounded hit targets, 16 × 16 icons, a 4 px gap, and an active
surface background. Application-owned window controls stay unchanged on the
right. The center is a native
draggable region; action and window controls are explicit no-drag regions and
call the generated Tuffite Window API. New Conversation is a fixed Chat Sidebar
menu item immediately below search; it moves focus to an empty composer under
the selected Project, and the first message creates
the Thread. The composer owns adding, removing, ordering, and selecting the
Thread's local/SSH/Tunnel Workspaces.
The sidebar toggle always changes sidebar visibility. Thread search opens only
from the sidebar search button or the standard Ctrl/Cmd+K shortcut.

The outer shell is a real translucent native surface. The title bar is
transparent over the existing product-tuned shell material; opaque content
surfaces preserve text and Terminal contrast. The inner frame has a 12 px radius
and 4 px left/right/bottom inset, while the native frameless window requests a
12-DIP rounded outer corner.

## 3. Navigation and ownership model

The product cardinality is `Project 1:N Thread` and `Thread 1:M Workspace`.

- `Project`: top-level organization for related work, defaults, saved workflows,
  and Threads. It is not a filesystem root.
- `Thread`: persistent conversation, Goal/Workflow timeline, approvals, Agent
  routing, Artifacts, and one or more Workspace bindings.
- `Host`: the selected local or remote execution environment. It owns its
  Workspaces, installed Agents, processes, and running sessions.
- `Workspace`: a confined execution root on one Host. A Thread can attach
  several Workspaces from its selected Host while retaining one primary
  Workspace for relative paths, Git review, and default execution.
- `Goal`: one outcome pursued inside a thread; a thread may contain sequential
  goals but only a small number should be active.
- `Worktree`: optional isolated execution mode for write-heavy goals.
- `Artifact`: a file, report, preview, screenshot, patch, or structured result
  owned by a Thread, with optional producer Workspace provenance.

The Sidebar is a parent/child directory tree: Project nodes contain Thread nodes,
and Thread nodes contain Artifact nodes or optional Artifact groups. Workspaces do
not form another Sidebar level because they are execution context rather than
navigable content. A Thread row may show compact Workspace count, local/remote,
and health badges.

The default create flow is one input: create a Thread in the selected Project,
attach one or more Workspaces from the composer, then describe the goal. Advanced
options—Agent, model, worktree mode, saved workflow, permissions, and budget—are
behind one disclosure control and remembered per Project.
The Thread title bar always shows a compact Host selector. The composer places a
compact Codex and external ACP Agent selector immediately after Attach
Workspace; changing either affects the next Task/Attempt and preserves prior
Host/Agent recovery state. The composer does not render a persistent keyboard
shortcut hint.

The Workspace affordance in the composer provides:

- add a folder, clone, or registered root on the selected Host;
- chips for every bound Workspace with alias, connection status and read/write scope;
- one explicit primary Workspace and zero or more attached Workspaces;
- drag/reorder and per-Attempt selection without changing Thread ownership;
- unbind without deleting source files, endpoint credentials, or existing Artifacts.

The Hosts section of Manage fills the framework left panel and separates Paired
Devices from Remote Hosts with exclusive tabs. It handles pairing, connection credentials, host/device
keys, lifecycle, Agent inventory, Workspace roots, health, aliases, policy, and
revoke. Its intended Remote Control flow needs only Ovule running on each
paired device. The Host advertises `desktop.control`; Link relays
CRD signaling and authorized input while the Client renders the CRD WebRTC video
track, pushes clipboard text, and automatically reconnects. A credential-free
SPICE WebSocket bridge remains only
under Advanced as a development fallback. Link reachability checks are
sequential and show Checking/Reconnecting until three consecutive failures make
a Host Offline, rather than flashing Offline on one discovery failure. Attaching
a Workspace to the current Thread remains a composer action.

The management page, labeled **Workspace Center**, has three projections rather
than another directory tree:

- **Endpoints**: Local, SSH, and Tunnel machines with authentication, fingerprint,
  latency, host/runtime version, last seen, and revoke controls;
- **Bindings**: Thread-owned roots grouped by Project/Thread, showing alias,
  primary/attached role, permissions, active Attempt count, and open action;
- **Sessions**: live Workspace Host, port-forward, PTY, ACP, Browser, and handoff
  sessions with owner and stop/reconnect controls.

Adding a Workspace from the composer may invoke a focused sheet from Workspace
Center, but success returns directly to the composer with the new chip selected.
Endpoint deletion previews every affected binding/session and never deletes source
files. Health or authentication repair preserves the binding ID and Thread history.

### Sidebar tree behavior

- Project nodes support create, rename, collapse/expand, reorder, archive and delete;
- Thread nodes support create, rename, move between Projects, reorder, archive and delete;
- Artifact nodes support open, rename display label, group/move within the owning
  Thread, reveal origin, export and delete according to retention policy;
- drag-and-drop updates explicit sort keys and ownership through backend commands,
  not optimistic client-only tree state;
- deleting a Project or Thread previews affected Threads, events and Artifacts, but
  never deletes Workspace source directories or endpoint credentials;
- search returns Project, Thread and Artifact results with ancestor breadcrumbs;
- unread/running/blocked state rolls up Artifact -> Thread -> Project without adding
  Workspace nodes to the tree.

Workspace chips are execution controls rather than navigation objects. Clicking a
chip opens a compact inspector; `Manage Workspaces` opens the full management page.
Connection errors stay visible on the chip and Thread badge without moving the
Workspace into the Sidebar.

## 4. Goal surface

The header shows title, status, concise progress, current phase, active workers,
elapsed time, cost when known, and pause/stop. Clicking it opens acceptance
criteria, constraints, budget, and evidence.

The phase strip is the default workflow visualization. A graph is available in
the Workflow tab but is not always visible. During replanning, completed phases
remain stable and changed/superseded work is explained in a timeline card.

The composer supports:

- normal goal steering;
- adding and selecting multiple local/SSH/Tunnel Workspaces;
- choosing the primary Workspace and attached read/write scopes for the next Attempt;
- file and image attachments;
- `@artifact` and `@file` references;
- an isolation pill for shared/worktree/read-only execution;
- explicit terminal input when an interactive session is selected;
- voice input as a later UI capability without changing session messages.

## 5. Conversation timeline

Timeline cards include:

- user request or steering;
- assistant summary and final response;
- compact plan/phase updates;
- approval requests with exact impact;
- changed-files summary and diff entry;
- terminal/tool activity collapsed by default;
- artifacts with preview actions;
- blockers and verification results.

Streaming text updates one semantic assistant card. Internal model reasoning is
not exposed as fabricated chain-of-thought; only model-provided safe summaries,
tool activity, and explicit progress events appear.

## 6. Changes and review

The Changes tab groups files by goal and task and supports unified/split diff,
stage-like selection for review only, comment threads, open in editor, revert
through an explicit confirmed operation, and acceptance evidence. It clearly
separates the user's existing dirty changes from Ovule-produced changes.

When a goal uses a git worktree, the UI shows source branch, worktree location,
base commit, and integration options. Ovule never performs a merge, commit,
push, or destructive reset without a user command and the corresponding policy.

## 7. Terminal

The target Terminal attaches xterm.js to a selected Agent or shell session. It
will support read-only observation by default, explicit takeover, resize, copy,
search, Ctrl+C, and return-to-agent. Input targeting must always remain visible
to avoid typing into the wrong session.

Raw terminal output is not the main assistant response. The adapter separately
emits normalized agent events used by the timeline and channel projections.

Users may open multiple Terminal tabs. A tab owns its command draft, xterm
instance, bound Thread, and the run IDs it created. Persisted runs retain that
tab owner ID and remain authoritative, but
one tab does not mirror another tab's presentation state. Closing a tab disposes
only that view after any active command finishes or is cancelled; persistent PTY
ownership will be added when the Terminal backend moves beyond bounded command
execution.

The current bounded-command UI accepts input directly inside xterm and renders a
compact `PS C:\…\workspace>` prompt. It uses responsive rows/columns, a
10,000-line scrollback, per-tab history and Up/Down recall, find-next/previous,
selection/output copy, rerun, clear, and a compact status toolbar. It intentionally
labels itself bounded command mode: interactive
process input, shell-owned prompt/completion, Ctrl+C delivery, alternate screen,
and process continuity require the planned PTY/ConPTY plus DataPipe backend.

Bounded commands stream stdout/stderr line deltas to their owning xterm through
the typed `ovule:terminal-output` event. Monotonic per-run sequence numbers
drop duplicate/out-of-order delivery. The final 2,000-line/512-KiB bounded
snapshot remains authoritative and is committed only once; a stream fragment
never triggers full Workspace serialization.

## 7.1 Connected apps and human handoff

Manage fills the framework left panel and uses a shadcn Sidebar for Hosts,
Connected apps, Agents, Models, Skills, Tools, Toolchains, and Extensions.
Connected apps presents an onboarding-style account flow for common presets or
any user-named application. Endpoint, provider, and bearer-environment fields
are hidden under a developer-only Advanced section. The current build can store
that manual HTTPS MCP Tool and grant it to selected Agents, but does not yet
bundle the direct/MCP OAuth callback and secure credential lifecycle required
for ordinary one-click account sign-in. Pipedream and Composio are optional;
self-hosted Activepieces is the default open-source guidance and Nango is a
self-hostable source-available alternative. Open connection setup opens the
selected provider guidance in a visible Workbench Browser. The user triggers a
ready connection by asking an authorized Agent to act in the app; there is no
separate execution button.

Agents can emit the bundled `human-handoff` block with instructions, an optional
Appshot, and a browser or SPICE target. The card opens an independent Workbench
pane. Separately, a paired Remote Host opens a CRD WebRTC desktop through
Ovule Link with keyboard/mouse/scroll, clipboard, live network metrics, and
reconnect. A
development WebSocket bridge can still open the embedded SPICE framebuffer from
Advanced; it is not presented as the expected end-user flow and does not accept
ticket secrets in the URL. Choosing Done, continue posts a
durable Thread message before the Agent resumes.
The exact protocol and security boundary lives in
[Connected apps and human handoff](connected-apps-and-human-handoff.md).

## 8. Workbench Browser

### Default URL handling

Every product action that opens an `http://` or `https://` target routes through
`BrowserService::open` and displays the result in the Workbench Browser. This
includes message links, Agent Browser Use, setup/authentication links, Help/docs,
Artifact links, `window.open`, popup requests, and URLs emitted by Terminal or
remote services. Feature code must not call the OS browser directly.

Default behavior:

- a normal click activates an existing compatible Browser tab or opens a new one;
- Ctrl/Cmd-click always opens a new background Workbench Browser tab;
- Agent navigation uses an Attempt-owned BrowserSession and reveals the same tab
  when observation or handoff is required;
- authentication opens a dedicated visible auth tab with isolated profile and
  callback state, rather than reusing an arbitrary browsing tab;
- `_blank` and approved popups become Workbench tabs under the opener's policy;
- non-HTTP protocols, downloads and external applications always require an
  explicit policy decision.

`Open in system browser` remains an explicit context-menu/overflow action. It may
also be offered when an identity provider or site technically prohibits embedded
user agents, but the default attempt is always the Workbench Browser and the UI
explains why an external handoff is required.

For a URL such as `http://localhost:3000` produced inside a remote Workspace,
BrowserService binds the request to that Workspace, creates a scoped port forward,
and opens the forwarded target in the Workbench Browser. The omnibox shows the
original remote authority plus a Workspace badge; users never have to copy a
forwarded loopback port manually.

Local paths and `file://` inputs are not HTTP navigation. They become sandboxed
preview leases and are still rendered in a Workbench Browser tab.

Browser tabs have explicit kinds and are reused only within the same kind/owner:

| Kind | Owner | Persistence and reuse |
| --- | --- | --- |
| General | user + Project | normal browsing profile; user controls close/reuse |
| Attempt | Attempt | isolated policy/profile; survives while the Attempt or handoff needs it |
| Auth | auth transaction | isolated, visible, non-reusable; closes after verified callback |
| Preview | preview lease | unique origin; closes/revokes with the lease |

The tab chrome always shows kind, owning Thread/Attempt, profile, Workspace/port
forward when present, and whether Agent automation or human control is active.

### Browser Use reveal contract

A `ovule:browser-use` UI request carries an optional target. It reuses the
Browser tab, expands the workbench panel, activates that tab, and navigates its
`<explorer>` surface. Repeated requests increment a navigation generation so the
same target can deliberately reload; merely clicking the Browser navigation
item does not replay an old automation request. HTTPS targets navigate directly.
Local paths and `file://` inputs are converted to workspace-relative paths and
must pass the Rust preview confinement/sanitization path.
Dragging the workbench separator adjusts the grid track itself; the Thread
surface has a zero intrinsic minimum so it shrinks with the remaining space
instead of being covered by the right-hand panel.

This is a presentation contract, not the Browser Use authority boundary. The
future BrowserService owns accessibility snapshots, element references,
click/type/wait, screenshots, profiles, approvals, and audit events. The
renderer event cannot grant those operations or substitute for that service.

## 9. Artifact workbench

Artifact rendering is selected by MIME type and trust level. Initial renderers:

| Type       | Default view              | Editing                             |
| ---------- | ------------------------- | ----------------------------------- |
| Markdown   | rendered document         | WYSIWYG + source                    |
| HTML       | isolated live preview     | source editor, later visual editing |
| Text/code  | syntax-highlighted viewer | source editor                       |
| Image      | image viewer              | no destructive edit in v1           |
| JSON       | tree + source             | source editor                       |
| Patch/diff | diff viewer               | review comments                     |
| Other      | metadata + reveal/open    | external application                |

Artifacts show producer, goal/task, revision, source path or generated status,
last modified time, and whether content is safe to share to a channel.

## 10. Markdown WYSIWYG

Milkdown is the recommended first editor because it is Markdown-first,
ProseMirror-based, headless, and plugin-driven. Markdown text remains the storage
and interoperability contract; the editor state is not persisted as a proprietary
document format.

### Modes

- `Edit`: WYSIWYG with block insertion, tables, task lists, code blocks, links,
  images, and slash commands;
- `Source`: CodeMirror Markdown source;
- `Split`: editor and rendered preview;
- `Read`: distraction-free rendered document.

The first release targets CommonMark plus reviewed GFM extensions. Unsupported
raw HTML or extension syntax is preserved as an opaque/source-editable block and
never silently discarded. A round-trip test corpus guards formatting.

### Save and external changes

The editor loads `(path, content hash, revision)`. Save uses an atomic temporary
file replacement only if the on-disk hash still matches. If an agent or external
editor changed the file, Ovule shows a three-way comparison and asks the user
to choose or merge. Autosave applies to Ovule-owned draft artifacts; source
workspace files require an explicit save by default.

Edits made by the user are recorded as artifact revisions and may be attached as
new goal input. A running agent does not automatically overwrite an open dirty
editor buffer.

## 11. Local HTML preview

The preview is a separate unprivileged WebContents, displayed through Tuffite's
normal `<explorer>` same-layer surface. Users may paste a `file://...html` URL or
choose a local HTML file, but Ovule converts it into a preview lease; the
committed WebContents URL is never raw `file://` and never receives ShellAPI.

### Preview URLs

```text
ovule://p-<lease-id>.preview/index.html
```

The browser process maps a short-lived lease to one canonical preview root. It
rejects parent traversal, encoded separators, symlink escapes, absolute paths,
and access after lease revocation. The page receives deterministic MIME types
and `X-Content-Type-Options: nosniff`.

### Default policy

- scripts disabled;
- no ShellAPI or daemon IPC;
- network denied;
- popup, download, external protocol, geolocation, camera, microphone,
  notifications, and clipboard denied;
- navigation confined to the lease root;
- unique opaque host per preview lease, with origin data cleared on revocation;
- restrictive CSP with inline style allowed only when needed for generated
static pages.

The shared `ovule` scheme does not imply a shared origin. The App uses host
`app`; every preview lease receives a distinct `p-<lease-id>.preview` host, so
Chromium origin isolation remains `scheme + host + port`. ShellAPI is registered
only for `ovule://app`, never for `*.preview`.

The user may explicitly enable `Interactive preview` for trusted content. That
permits scripts within the lease but still denies ShellAPI, local file access,
external network, and privileged browser features. The trust choice is per lease,
not a permanent directory exemption.

The current Tuffite `<explorer>` intentionally inherits the outer document's
`BrowserContext` and `StoragePartitionConfig`. Preview isolation therefore comes
from a unique lease origin and browser-enforced capability denial, not from an
unimplemented per-element partition. If testing shows origin separation and
cleanup are insufficient, a general Tuffite ephemeral-partition option can be
designed later without changing the preview URL or lease contract.

### Development server preview

For a user-started local dev server, Ovule may embed an allowlisted loopback
origin after confirmation. This is a distinct mode with visible origin and stop
controls. Ovule does not silently execute package scripts to create it.

### Refresh and inspection

A filesystem watcher debounces changes and reloads the preview. The UI offers
viewport presets, open DevTools, copy preview URL for the local app only, and
capture screenshot as an artifact. Console and network errors are projected to
the artifact inspector without granting the page access to the parent UI.

## 12. Zustand state

Zustand is split by ownership rather than accumulated in one workspace hook:

- `runtime`: backend snapshot, busy/pending/error state, ShellAPI invocation,
  workspace revisions, and ordered streaming Agent-message reconciliation;
- `selection`: selected Project, Thread, Goal, primary Workspace, and attached
  Workspaces with snapshot-aware defaults;
- `workbench`: sidebar visibility, workbench open state, tabs, active tab,
  Terminal ordinal, and persisted left/right column widths.

Workspace binding/connection lifecycle and Browser/Agent event subscriptions are feature hooks.
Navigation, layout, drafts, and projections are separately composed, and form
drafts remain local unless another component genuinely needs them.

Commands use an expected daemon revision. The UI applies optimistic state only
for reversible presentation such as marking a card expanded; authoritative goal
and workflow transitions wait for daemon confirmation.

## 13. Accessibility and keyboard use

The workbench supports complete keyboard navigation, visible focus, semantic
headings/regions, screen-reader labels for workflow states, reduced motion, and
high-contrast themes. Graph information always has a list/table equivalent.
Status never relies on color alone.

Suggested shortcuts include new goal, project/thread switcher, focus composer,
toggle context pane, open changes, open workflow, open terminal, and command
palette. Shortcuts avoid overriding common editor/browser text commands.

## 14. UI acceptance tests

- Create a Project and Thread, bind two Workspaces from the composer, and start a
  Goal without opening the management page.
- Navigate Project -> Thread -> Artifact entirely from the Sidebar while Workspace
  bindings remain composer execution context.
- Unbind a Workspace without deleting its files, endpoint credentials, or Artifacts.
- Open message, Agent, Help, authentication, and remote dev-server HTTP/HTTPS links
  in Workbench Browser tabs; verify no path silently launches the OS browser.
- Open a remote Workspace `localhost` URL through an automatic scoped port forward
  while preserving the original authority and Workspace identity in the UI.
- Resolve App, auth callback, preview, Artifact, and Workspace inspector URLs through
  the single `ovule://` router; prove that `*.preview` cannot access App ShellAPI
  or another preview lease's storage.
- Observe a single-task run and a dynamically expanding workflow.
- Pause, steer, approve, and resume without state disagreement after reconnect.
- Review generated and pre-existing dirty changes separately.
- Edit CommonMark/GFM Markdown in WYSIWYG and source modes without lossy round
  trips.
- Detect and resolve an external Markdown file change.
- Render a static local HTML site with relative assets and live refresh.
- Prove preview denial of ShellAPI, network, traversal, popups, and expired leases.
- Use the complete goal flow by keyboard and screen reader.

## SPA routes and pane ownership

Ovule has one HTML entry (`desktop/index.html`) and one React bootstrap.
Packaged routes: `ovule://app/`,
`ovule://app/projects/<project-id>`,
`ovule://app/projects/<project-id>/threads/<thread-id>`,
`ovule://app/workspaces`,
`ovule://app/artifacts/<artifact-id>`, and
`ovule://app/panes/<kind>?tab=<id>&thread=<id>`.
The explicit `app.asset_routes` manifest map resolves these paths to the same
built HTML document. Development uses the corresponding Vite paths.
The framework must include asset-route support before packaging this UI.

Framework contains Chat (Sidebar plus the Conversation Thread) and Workbench,
an initially hidden right column. `--framework-radius` controls both columns
(12px); the column gap is 4px. Pointer and keyboard resizing are supported.
Workflow, terminal, markdown, Office and browser each have an Explorer-owned
surface. Workflow and terminal omit the address editor.

The Sidebar renders Project -> Thread -> Artifact as a stable parent/child tree.
Workspace bindings never become tree children; Thread rows expose only compact
Workspace count/type/health badges. Thread artifacts open in Chat and appear as
indented Sidebar children. Selecting a conversation restores its Thread Explorer. Thread and artifact
Explorer surfaces remain mounted; inactive artifacts retain their size in an
offscreen, non-interactive region to avoid native surface reloads. Explicitly
moving an artifact to Workbench removes its Sidebar child and preserves its
Explorer and document state. Switching tabs and hiding Workbench also preserve
them.
Active terminal runs prevent closing their owning pane.

The Workbench title bar exposes an Add menu, favicon previews, active title and
URL, all-tabs dropdown, address editor with suggestions, close, expand and
hide. Tab-menu rows are 32px high with 1px gaps and contain their close action.
`smoke:spa` verifies routes, root RPC, artifact ownership, surface retention,
resizing, omnibox suggestions and persistence in stock Edge. It does not test
native Explorer or the packaged protocol. Native Thread surface and stress
adapters use the SPA paths. The full legacy native CDP suite needs tool-content
locators moved into the individual pane targets before it can be used as a
release gate for this layout.
