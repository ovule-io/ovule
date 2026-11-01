# Ovule smoke matrix

Package integrity validates the explicit bundled file inventory and HTML entries.
Runtime Rust setup owns URL mappings and origin policy; the native runtime suite
checks these behaviors without requiring a runtime JSON snapshot.

The `runtime` suite exercises the packaged Application/Browser dispatch paths,
origin-scoped `browser.rules` and CSS-style Explorer behavior, including external
protocol delegation, initiating origin, one-shot responses, deadline cancellation
and blocking without a native prompt,
detected shell profiles, persistent native PTY input/state/resize/reattach/close,
Explorer download ownership and pause/resume through completion and publication,
custom-protocol confirmations for both page links and application navigation
(Windows UIAutomation dismisses them without launching another app), and resident
WebAuthn credentials with a virtual internal authenticator. It uses isolated
profiles, temporary downloads and a loopback HTTP fixture. Physical Windows Hello,
Touch ID and iCloud passkeys remain explicit device/signing checks. Non-Windows
runs report the native external-protocol dialog adapter as skipped.

Core onboarding uses an isolated fake CLI and loopback authorization page on
Windows as well as Unix. Windows compiles a small native fixture executable with
the same login protocol, rather than skipping setup and then attempting flows
with no default Agent. The native launcher does not execute batch files.

## Markdown, unsupported files and centered states (2026-10-30)

`explorer-resources-smoke.mjs` verifies default Markdown headings, emphasis, lists,
code blocks, document-relative links and scrolling. Local links are rewritten as
inert references before the standard sanitizer and then mapped to application
previews; raw HTML does not gain file URL permissions. ZIP and other unknown
extensions commit an unsupported-format route rather than leaving old content
visible. Oversized code/Markdown and Office reads use a centered shared state with
an icon, file name and a friendly limit message, without raw Tuffite error text.
Screenshots are `/private/tmp/explorer-file-markdown.png`,
`/private/tmp/explorer-file-unsupported.png` and
`/private/tmp/explorer-file-large.png`.

`experience-smoke.mjs` additionally asserts that selecting ZIP retains the same
Explorer and its Chromium navigation history. Explicit local-file selections
use the native `load` method, as do ordinary web navigations. The native adapter
checks rendered Markdown, unsupported ZIP, centered oversized-YAML states and zero
downloads in the immutable candidate. Preview heights follow the embedded document
rather than top-level dynamic viewport units.

## Local Office previews, scrolling and picker dismissal (2026-10-30)

`explorer-resources-smoke.mjs` mounts the production local Office preview with
real DOCX/XLSX/PPTX renderers and generated OOXML fixtures. It verifies source
text/cells, read-only spreadsheet cells, Word and spreadsheet wheel scrolling,
PowerPoint canvas/navigation and teardown without delayed-render exceptions.
The same adapter wheel-scrolls long YAML, checks horizontal code scrolling, and
verifies file-picker inside clicks, outside clicks with stopped propagation,
iframe focus handoff, preserved outside focus and Escape dismissal.

Local Office routes read bounded native bytes without requiring a Thread. Legacy
DOC is converted to DOCX in memory through macOS textutil; the source is never
modified. Rust tests cover binary reads and the conversion. Other platforms
explicitly report that legacy DOC conversion is unavailable rather than claiming
support. The native local-files adapter opens DOC (macOS), DOCX, XLSX and PPTX in
fresh Explorers with isolated profiles and records native Office and scrolled
screenshots. It checks file API metadata, renderer mounting and zero downloads.
The YAML portion additionally retains one Explorer and checks native back/forward
between two scoped file origins. Rebuilt extension resources must be staged before
preparing the immutable candidate so the isolated-world CSS matches source.

## New Tab restart and command ownership (2026-10-30)

`experience-smoke.mjs` restores production pane state from browser localStorage
with both an original Downloads target and a newer web/code URL. Reloading must
retain the latest location without replaying the persisted request counter. A new
address request must still reach the restored direct Explorer; an older outstanding
metadata response cannot overwrite it. The fixture also keeps a hidden New Tab
beside the active file pane and verifies it does not consume that pane's command.
A visible New Tab rejects commands addressed to another pane as well. A blank tab
with stray URL metadata and no navigation request restores to the empty input.
Unit coverage preserves intentionally opened directory targets. These are renderer
lifecycle and storage fixtures, not evidence of a rebuilt native restart run.

## Local file code and breadcrumbs (2026-10-30)

`explorer-resources-smoke.mjs` verifies the production code decorator and YAML
preview, original newlines, inert source text, directory popovers, nested browsing,
filtering, file selection, Escape dismissal, progressive ancestor collapse and
restoration. Hidden ancestors remain selectable. Screenshots include
`/private/tmp/explorer-yaml-preview-ui.png` and
`/private/tmp/explorer-breadcrumb-overflow-ui.png`.

`local-files-native-smoke.mjs` runs a fresh immutable candidate with isolated data
and real native file APIs. It reads encoded local paths containing spaces, Unicode
and `#`, verifies directories sort before files, opens YAML in a real Explorer,
switches to YML and asserts there are no native downloads. This adapter is separate
from the stock-browser fixture because native MIME handling and guest Shell API
permissions require the business runtime and native Explorer. Run it through
`run_smoke.py --suite local-files --package-root dist/<candidate>` or directly.
Unit tests additionally cover source URL mapping, bounded UTF-8 reads, binary-file
rejection, disposal, document-bound writes and URL encoding. These checks do not
constitute the full release gate or native history/transfer validation.

## Inline approvals, tool groups and streaming follow (2026-10-29)

`agent-approval-smoke.mjs` mounts the production approval store and Confirmation
view in an isolated browser. It verifies attempt-scoped placement, no dialog or
focus theft, inert argument previews, explicit allow/deny, host cancellation,
absence of task-wide controls for invocation-only requests, responsive layout and
teardown denial. It also restores host-pending requests after a missed broadcast or
late mount and checks that replay never grants permission. Presentation acknowledgement
is separate from user consent; Rust regressions distinguish timeouts from negative
responses and retain whether a card mounted. Escape denies only when focus is inside a confirmation; it does
not intercept the composer. The native Harness adapter now locates the inline
`[data-agent-approval]` card rather than a dialog element.

`agent-approval-smoke.mjs` also mounts the production approval-mode picker and
checks host-owned Ask each time / Approve for me transitions, rejected updates,
and that selecting a mode never sends a renderer-side tool approval. Rust tests
verify exact invocation review, pending-request review, default/manual fallback,
no reviewer availability, and rejection of broad reads, unknown commands/flags,
symlink targets, writes, process inspection and network grants.

`chat-stream-smoke.mjs` gives the user and assistant messages the same Attempt ID
and asserts that exactly one confirmation appears, exclusively in the assistant
message. It also exercises the production MessageList and ToolGroup: live
expansion, default completion collapse, preserved manual expansion, tool result
inspection, history reading without forced scrolling, scrollbar-to-bottom resume,
repeated text growth, delayed layout growth, history prepend anchoring and thread
switching. Chat uses follow-bottom instead of per-user-turn scroll anchoring; the
shared MessageScroller primitive continues to own resize and scroll state.

These are stock-browser source fixtures with synthetic messages and mocked tool
approvals. They do not verify native bridge event routing or a rebuilt installed
package. Run the native Harness adapter on a new immutable candidate before release.

## Runtime naming and cancellation review (2026-10-30)

Kernel regressions cover cooperative cleanup returning success after cancellation
and cancellation raised while a result is being polled. Both keep the tool card
and execution diagnostic cancelled, with uncertain effects in the journal.
Message-service tests call restart without renderer orchestration and verify
that it revokes the source Worker before dispatching the edited prompt.
`agent-approval-smoke.mjs` holds a mode update and a concurrent old read separately;
after rendering settles, the old read cannot overwrite the successful new mode.

Optional model endpoint discovery lives in `runtime/model_metadata.rs`; the
Attempt-owned Rig adapter lives in `runtime/tool_projection.rs`. Architecture
checks continue to enforce neutral provider dependencies and file/directory Rust
modules. Diagnostic aliases preserve existing exported report consumers.

## Cancellation, tool failures and admission validation (2026-10-29)

`chat-stream-smoke.mjs` verifies preservation of partial reply text after stopping,
a compact localized stop notice, normalization of legacy cancellation text,
transparent message backgrounds and separate invocation/tool-result failure
counts. Tool titles and group headers never receive error coloring; backend error
details stay expandable. The fixture captures `/private/tmp/ovule-tool-statuses.png`.
Unit tests cover cancellation before output, cancellation after streaming and
classification of timeout, backend, denied, process-result and stopped states.
Provider regressions verify that preflight errors neither request authorization
nor invoke the backend. The native host permission test adds an invalid-path case
and still exercises one-call grants and denial isolation. Review tests cover stat
formatting, nonrecursive listing, codesign requirements and selected ps columns,
while write/network/unknown command sequences remain manual.

## Thread editing, cancellation and branches (2026-10-29)

`thread-controls-smoke.mjs` mounts production ConversationMessage, PromptEditor
and GenerationControl. It verifies Stop never submits a prompt, pending
cancellation disables the control, editing replaces text inside the original
bubble without duplicate content or editor buttons, automatic input focus,
Enter/Shift+Enter/Escape, IME composition and failed-draft recovery. Rust tests
verify same-Thread prompt replacement, stable prompt IDs, removal of old replies
and later turns, attachment retention and suppression of late text/tool blocks.
The real message-service test verifies dispatch of the edited prompt and prevents
regression of the empty-attachment validation failure. Explicit fork remains a
separate operation with isolated message IDs and completed-trace snapshots.
Host review tests replay all nine request shapes from the repeated-confirmation
report and reject write/network grants and hidden PlistBuddy mutations.
`agent-approval-smoke.mjs` also verifies that live mode updates show and clear the
manual-review fallback explanation on an already-pending card. Kernel regressions
assert that switching mode resolves a live request with a distinct policy decision
without creating a reusable task grant.

## New Tab, startup and progressive history (2026-10-28)

Default search-engine coverage uses the production General preference control:
Bing, Google, Baidu and DuckDuckGo persist in the existing `ovule.search.url`
preference. `experience-smoke.mjs` checks every preset, synchronization with an
already-open page, reload persistence, and exact encoded search destinations
from New Tab and titlebar. Explorer facades record URLs, so these checks never
send queries to third-party search providers. Preference unit tests preserve
valid legacy custom URLs and reject invalid/credentialed persisted values.
The native Omnibox adapter additionally opens Settings / General, selects Google,
and checks that the actual General control restores that selection after reload.

The shared Omnibox keeps the original input DOM node while expanding a manual
HTML popover into the top layer. Input and suggestions share one rounded panel,
including in the Explorer titlebar; the titlebar reserves the original input
height. Browser fixtures cover retained caret/text, readable themes, keyboard
selection, Escape, and consistent search labels without duplicated prefixes.

Blank New Tabs now render directly in the main UI; the native Explorer is created
only after navigation. `experience-smoke.mjs` checks that an empty tab creates no
nested renderer, accepts raw keyboard input without clicking, and preserves the
draft/focus on tab activation. `omnibox-native-smoke.mjs --package-root <candidate>
--keep-run-root` checks those same invariants in a real isolated native package,
including New Tab and titlebar suggestion screenshots. This replaces the previous
iframe-only focus model, which could not establish native keyboard routing.

Explorer resources additionally check that loadstart shows a non-interactive
2px top marquee, ordinary loadcommit never activates control feedback, loadstop
and errors clear the progress bar, and only explicit Browser Use control-activity
pulses retain the edge halo. Download, PDF transfer/replay, and dismissal checks
remain in the same resource adapter.

`node smoke/experience-smoke.mjs`, run from `desktop`, exercises the production
PaneToolbar, BrowserPanel, Omnibox and root request dispatcher in an isolated
browser: direct New Tab creation, automatic search focus, all launch actions,
directory picker cancellation/selected root, the existing Terminal and Remote
Host dialogs, and Workflow placement. The directory picker uses a deterministic
stub; this does not establish native OS picker behavior.

`desktop/smoke/chat-stream-smoke.mjs` additionally checks a 2,000-message
conversation's bounded initial tail, offscreen body virtualization, stable visible
message position when prepending history, clean thread switching, and a
10,000-message switch timing sample. Existing streaming and follow-bottom checks
remain. The sample is renderer fixture timing, not packaged cold-start latency.
`explorer-escape.test.ts` covers guest-document Escape, IME composition,
navigation, teardown, and shortcut removal/restoration around Explorer transfer.
Native cross-WebContents keyboard dispatch and packaged cold-start timing still
require a new candidate; stock-browser fixtures cannot prove them. The thread
route loads its extension catalog beside the conversation, so optional
contributions cannot gate the initial conversation snapshot.

## Chat edge fade and composer focus (2026-10-28)

`desktop/smoke/chat-stream-smoke.mjs` checks the production MessageScroller
viewport bottom mask while reading history and at the live edge, plus no fade
for non-overflowing content. The same isolated browser fixture loads the
production composer CSS and checks that light/dark focus preserves its background
and changes its glow. Existing streaming, tool, citation and scroll-resume checks
remain in this adapter. No real conversation or provider is used.

## DeepSeek reasoning budget and answer recovery (2026-10-28)

The current DeepSeek thinking model IDs use a 64K completion budget. An empty
`length` result may make one additional, 8K, thinking-disabled, tool-free answer
request. `OVULE_TEST_MODE=1 python3 scripts/cargo.py test -p ovule-agent --lib
rig_answer_ --offline -- --ignored` exercises the production HTTP/SSE path against
a local fake server: successful recovery, second-empty termination, unrelated
empty-stop handling and refusal to dispatch recovery tool calls. These four
listener tests are explicitly ignored in ordinary sandbox-only unit runs.
No real provider key, account, or paid request is used. Unit coverage also checks
legacy/other-provider budgets, and diagnostic tests classify the pasted legacy
`Some(Length)` error without inventing missing metrics. A new candidate's
`app-startup.mjs` validates launch and native bridges; it does not establish live
DeepSeek model behavior.

## Confirmation and download history (2026-10-27)

Download history dismissal is additionally covered by
`desktop/smoke/explorer-resources-smoke.mjs`: inside clicks keep the panel open;
outside clicks (including stopped propagation) dismiss it while preserving the
clicked control's action and focus; iframe focus dismisses without requiring
pointer events in the parent; Escape still restores the trigger's focus after
the close animation. Native Explorer focus handoff uses the same window-blur
path, but stock-browser iframe coverage does not prove native pointer routing.

`desktop/smoke/agent-approval-smoke.mjs` exercises the production React
Confirmation in an isolated browser: inert previews, queued requests, allow once,
Escape/close denial, native cancellation, teardown and the explicit automatic
approval choice. Rust tests bind automatic grants to an exact Attempt/tool,
reject forged IDs, retain cancellation, and revoke grants at executor teardown.

`desktop/smoke/explorer-resources-smoke.mjs` exercises the production download
button/panel with fake native records: overlay top alignment and left-side gap,
compact header with 8px bottom padding and no directory, file size/download time,
rounded hover cards, hidden empty state, known/unknown progress,
cancel, delete-file-and-record, folder reveal and PDF navigation/transfer persistence.
Files tests use temporary profiles and destinations to check collision-safe
publishing, source-cache preservation, history restart, published-file deletion, deletion-failure retention, tombstones and
outside-profile/symlink rejection. No actual user downloads or files are changed.
The native `app-startup.mjs` adapter additionally exercises directory configuration,
publishing, listing and physical deletion in a temporary browser profile/destination.
It guards startup against renderer-only Path RPC calls from native initialization;
`--finder-launch` also checks LaunchServices opening.
The application publishes completed downloads to its persisted configured folder;
changing the folder affects future completions. Native packaged integration of
the new ShellAPI endpoints must be checked on a newly built candidate before
release promotion; stock-browser fixtures do not establish native bridge success.

## Local desktop permission preparation (2026-10-26)

`node desktop/smoke/desktop-permissions.mjs --package-root dist/<candidate>.app --keep-run-root`
checks native Screen Recording / Accessibility status without prompting or changing grants,
requires the runtime Bundle ID to match the package channel, and verifies the shared
card in General and Hosts beside pairing / Keep this Host awake. Invalid permission
names must fail before any OS action. Run against separate debug and release packages.
Platform unit tests reject cross-channel and unbundled permission requests.
Authorization is an explicit button action only; visiting settings, pairing and keeping
awake must not prompt. macOS retains control of the grant; manual validation covers
the system prompt, return-to-app refresh and fully quitting / reopening after a grant.
Do not reset TCC or copy grants across debug/release for smoke.

## Remote desktop startup deadlines (2026-10-26)

Remote Control startup has separate budgets for Link authorization (12s),
Host TURN/native startup (25s), the Client facade (40s), and the renderer's
first-frame deadline (60s). Ordinary facade operations allow 15s so they do not
expire before Link's 12s request deadline. The Remoting Rust suite uses a paused
clock to require a Host response after 11s to remain consumable and stoppable.
Failures identify authorization, Host ICE/native startup, signaling or updates;
Host logs record timing and TURN presence without ICE credentials or SDP.

The `probe_link_host` example can authenticate an existing paired Host without
desktop capture. Explicit `--desktop-start` measures native startup and stops the
diagnostic session; `--capture-check` reports only capture dimensions/timing and
does not save or print the remote image. These are authorized live diagnostics,
not substitutes for synthetic smoke or proof of WebRTC first-frame delivery.

## macOS application startup (2026-10-26)

`mise x -- node desktop/smoke/app-startup.mjs --package-root dist/<candidate>.app --keep-run-root`
launches the native bundle with isolated application/browser profiles, waits for
CDP and the visible main-window titlebar, Agent setup heading and discovered Agent card, checks that the
process remains alive, and saves a screenshot. This is a startup check, not the
full native suite. The runner reads the executable name from
`Contents/Resources/manifest.json` and launches it from `Contents/MacOS`.

Platform resource tests cover macOS `Contents/Resources/assets` and portable
executable-adjacent assets. Extension tests require bundle resources to take
precedence over the compile-time checkout, ignore removed workspace directories
without manifests, and continue rejecting malformed manifests. Built-in Skills
use the same resource-root resolution as Extensions.
The application manifest's `beforePackageCommand` builds Web/extension assets
after native ShellAPI generation, so direct `tuff package` cannot reuse an older
frontend protocol. The startup probe must reach the setup heading, not just a
listening browser process. It allows 120 seconds for cold Rosetta startup.

Add `--invalid-link-identity` to seed an undecryptable Link credential in the
isolated profile. Application startup and Agent discovery must still complete,
and the encrypted bytes must remain unchanged. Link operations retain their
startup error for explicit recovery; startup must never rotate the identity.
On macOS add `--finder-launch` to run through LaunchServices using `open -n -W`,
with explicitly isolated application/browser data and a captured stderr log.
Also verify the installed bundle via LaunchServices with the existing profile
when diagnosing Finder-only failures; an empty profile cannot cover this case.

MacOS credential recovery tests authenticate synthetic Host/Client identities,
preserve identity plaintext through re-encryption, retain original encrypted
backups and access/provider files, and reject partial migration when either
identity fails authentication. Run
`python3 -m unittest discover -s scripts -p test_recover_macos_link_credentials.py`.
The Secrets Rust suite also requires a missing-key read to leave Keychain empty.
After recovering a real profile, compare both public IDs with the original
identities, query the native Host public ID, and require native Client credential
loading to succeed. Do not reset pairings during validation.

## Layers

| Layer                            | Runner step                                   | Required evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Platforms                                             |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Source contracts                 | `--source-checks`                             | Bun type/tests/format plus Rust fmt/check/test/clippy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Windows, macOS, Linux                                 |
| Theme system                     | `bun run --cwd desktop smoke:theme`           | Light/dark semantic tokens, neutral focus states, visible Sidebar hover/active levels, Thread Explorer appearance sync, shadcn MessageScroller structure and Agent avatars, neutral user/Agent message states, New Chat composer controls/file chooser/focus, 14px/12px type scale, bundled Geist Variable, screenshots                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Windows stock-browser adapter now                     |
| Package integrity                | always                                        | Manifest parses; every declared file matches size and SHA-256; no undeclared files exist; only built-in Extensions are packaged; Sample ACP/Channel and Claude are absent from application resources; installed third-party packages are exercised from isolated user data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Windows, macOS, Linux                                 |
| Packaged SPA                     | `spa-package`                                 | Stock Edge loads the exact packaged client and verifies Workbench Browser/Terminal/Markdown lifecycle, titlebar navigation and aligned popovers, Sidebar artifact actions and styling, resizing/persistence, plus Remote Workspace Center link import UI. Chat Sidebar must start expanded even when an older profile contains `ovule.sidebar=closed`; manual toggling remains available for the current run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Windows adapter now; add native adapters per platform |
| Thread surface                   | `thread-surface`                              | Isolated `<explorer>`, shared partition, root RPC, composer geometry, Workbench routing, session switching                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Windows adapter now; add native adapters per platform |
| Thread stress                    | `thread-stress`                               | Repeated conversation/child-artifact switching, parent restoration, active surface geometry, and resize/load stability                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Windows adapter now; add native adapters per platform |
| Full native CDP                  | `native-cdp`                                  | Onboarding, multiple Ovule profiles, downloaded npm payloads for third-party Sample ACP/Channel installation, ACP Agent streaming with an animated avatar, fake DeepSeek/Ollama, deterministic built-in CRD Computer Use calls, the unified Capability Registry and real screenshot calls through Rig Direct plus authenticated HTTP MCP Agent exposure in both Local and Remote Workspaces, Channel pairing/inbound/Agent/outbox/reply and uninstall cleanup, Goal/Workflow, Office/PDF, and reload. The `computer-use` scope makes the fake Codex ACP Agent negotiate HTTP MCP, consume `session/new.mcpServers`, run `initialize` / `tools/list` / `tools/call`, and require image content from `ovule_computer_control`; it then self-pairs a loopback Host, grants the active Workspace and Agent, and repeats the same screenshot through that Host's own loopback-only MCP endpoint. The `remote-control` scope self-pairs the isolated app over Ovule Link, registers that Host, and requires CRD session start, an initial signal poll from cursor zero, stats, and stop to succeed while optional `screenId` is omitted. The test asserts that Computer Use has no external Toolchain and that an isolated profile has no retired TryCua data. Rust coverage injects retired TryCua state, verifies quarantine, and requires the explicit cleanup operation before CRD replacement. Legacy outer-pane Browser/Terminal/Markdown assertions are reported as skipped; their current `/pane` lifecycle coverage is required from the `spa` suite                                                                                                                                                                                                                                                                                                                                                                                                                                      | Windows adapter now; add native adapters per platform |
| Onboarding surface               | `spa-package` + `native-cdp` onboarding scope | First-run UI uses a Radix Tabs state machine presented as exactly Agent → Provider → Model Steps, with Back/Next/Continue navigation and searchable shadcn Comboboxes for Provider and Model. It retains the Chat surface, has no Workspace prerequisite, and exposes no extension-specific Channel controls. Provider controls stay hidden until a Ovule Agent is selected; Model selection follows a ready provider. Dismissal survives reload.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Stock browser plus Windows native CDP coverage        |
| Remote Control dual-instance E2E | `remote-control-e2e`                          | Launches separate Host and Client Ovule processes with isolated application data, Chromium profiles, logs, and CDP ports; performs Link request/code approval, registers the Host, starts CRD, accepts the Host SDP offer from signal cursor zero, exchanges ICE, receives and decodes a desktop video frame, samples stats, sends IME text over the reliable CRD event channel, and verifies a real Host pointer down / unordered non-retransmitted move stream / pointer up drag while reporting first-move and release latency. The same run drives a real drag through the shipped React `<video>` surface and checks native keyboard input. The controller must fit the video element to the exact available width/height while preserving source aspect ratio, keep a 48 px icon toolbar and 36 px non-wrapping status bar, and preserve identical video geometry across network-stat refreshes. FPS, Latency, Jitter, Receive rate, and Loss stay visibly labeled on the left; Keyboard, Mouse, and End-to-end Link remain fixed icon slots on the right. Paste to Host and Ctrl+Alt+Del precede Reconnect as icon actions with tooltips, while connection state uses success/warning/danger semantic colors. The source architecture gate separately verifies that the 10px edge hot zone maps to exact remote edges, including letterboxed video. `-HostOwnedTurnFixture` provisions a fake TURN REST policy only in the Host process and requires the session-scoped credential to cross encrypted Link and configure Client WebRTC before SDP; the shared secret and all relay fields must remain absent from the Client process and UI. It also requires Tuffite logs to contain redacted username/password markers, no fixture shared secret, and no unredacted TURN password. `-ControllerOnly` is the focused packaged React gate for Host-owned ICE, first frame and reconnect; it does not replace the full native input gate. Failure preserves both processes' logs. | Windows adapter now; add native adapters per platform |

Color assertions must accept equivalent CSS Color 4 `color(srgb ...)`, `oklab(...)`,
or `oklch(...)` serialization and legacy `rgb(...)`, while preserving the same
channel thresholds. A content surface may also be transparent when it inherits
the validated non-transparent application shell background.
Placement assertions should prefer measured geometry; `grid-column-start: auto` is
equivalent to the first track when the retained setup surface is the sole grid child.
Native layout checks accept an attached but hidden desktop resize handle in
compact mode; keyboard resize and persisted width still have to update.
The Radix resizable handle exposes percentage-based ARIA values, so assertions
verify a monotonic change and a positive persisted pixel width instead of a fixed delta.
Sidebar toggle coverage handles both desktop collapse and compact Drawer mode.
| Desktop shell | `native-ui` | Launch, title bar, accessibility tree, resize hit tests, real edge drags, SQLite, compositor/window pixels | Windows UIA adapter now |
| Explorer context menu | `explorer-context-menu` | Remote page right-click remains alive and the native menu bounds stay within 32 px of the inner WebContents pointer position | Windows adapter now |
| Explorer DevTools | `explorer-inspect` | Inspect Element connects and picker overlay highlights the embedded page | Windows adapter now |
| Root DevTools | `root-inspect` | Root-page context menu opens DevTools and picker overlay highlights the app | Windows adapter now |
| Process exit | `process-exit` | Closing the last Tuffite window exits the browser root and every renderer/GPU/utility child from the selected package; the adapter refuses to run when that package already has processes and only cleans up its own isolated process tree on failure | Windows adapter now; add native adapters per platform |
| Hosts and Manage surface | `manage-dialog-smoke` | One shadcn Sidebar + content surface covers the complete framework left panel (Chat Sidebar and Workspace). The titlebar contains only Open setup, Manage, and Show workbench as 28 × 28 / 16 × 16 active buttons with 4 px gaps before unchanged 44 px window controls; Setup → Manage switches surfaces, Manage stays active while its Hosts section is visible, Hosts is a Manage sidebar section, New Conversation is fixed below Chat search, and Thread rows do not repeat their Agent. Hosts uses exclusive Paired Devices / Remote Hosts tabs. Paired Devices exposes a masked pair link with routing identity and invitation only, reveal/copy/5-second feedback/rotation, request-only OTPs, device identity, and per-device Workspace/Agent grants. Host identity and Client Link cleanup are tracked independently; each successful operation immediately removes its own cleanup button, while a genuinely new stale record can surface it again. Remote Hosts imports one credential-free Link, refreshes persistent inventory with a spinning refresh icon during the pending request, exposes Host-level Unbind and confirmed Remove, waits through Checking/Reconnecting before three failed Link handshakes become Offline, enables the desktop only when the Host advertises `desktop.control`, completes Bind → Unbind → Bind → Remove, distinguishes local Host authorization repair from resetting this Client's saved Link connections, and exposes one-click local Host identity reset through an in-app AlertDialog with progress/result feedback. Hosts contains neither the retired manual SPICE bridge nor an SSH Advanced surface. The Link Remote Control pane relays CRD SDP/ICE over Link, renders the WebRTC video track, forwards absolute pointer, wheel, USB HID keyboard, and clipboard input through the native CRD injector, displays WebRTC latency/jitter/throughput/loss, closes the Host session with the pane, and reconnects with bounded exponential backoff. Manage defaults to Agents and has no Connected apps navigation or Tools tab. Tools uses one bordered shadcn Tabs list for Built-in, Extensions, External MCP, and Add external MCP server; triggers stay single-line under narrow widths. Opening Workbench compacts the Sidebar to at most 60 px, centers every icon in a 34 px hover/active surface, exposes right-side tooltips, and retains usable content width without horizontal overflow. | Stock browser plus native RPC coverage |
| Host and Workspace interaction details | `thread-surface` | Conversation Thread title bar selects Local or remote Host; Goal authoring uses the `/goal` composer command; Workflow Node Thread shows a Workflow return action; composer places Agent immediately after Workspace; Node clicks open their own Thread, Workflow cards open a Goal-scoped Workflow tab, and composer Workspace selection opens without displacing the editor | Windows native Thread adapter |
| Dynamic Workflow Node Threads | Rust domain + `thread-surface` + `native-cdp` | `/goal <prompt>` creates an Agent-planned Goal/Workflow; `/goal #<goal_id> <prompt>` replaces remaining work; planning sees Host/Agent/Workspace inventory; Task Nodes persist execution context and create a Thread when execution starts; Gates remain approval state; successful Tasks and approved Gates advance existing dependencies; failures and rejected Gates can trigger a structured replan; superseded Nodes retain audit history; full Task output stays in the Workflow Node Thread while the graph stays in the parent Agent message and a separate draggable activity window exposes scoped Agent activity, waiting reasons, inline Gate review and setup/result shortcuts; the window has matching header/right gutters and supports close/restore; the Workflow tab renders a flat graph and activities with a single title and scrolls after expanding the node inventory; graph nodes have equal compact heights without clipped text | Cross-platform Rust plus Windows native adapters |
| Host pairing link | `thread-surface` + Rust tunnel test | Hosts emits an unversioned `/hosts/link` URL, displays the random six-digit code only in Paired Devices, uses stable named Link methods and Host-owned Agent launch, accepts the code through a six-slot Client OTP, supports revoke → re-pair, preserves recognized pairings and grants while migrating local authorization storage, offers explicit local repair for unreadable/future/inconsistent Host data, routes by the exact granted Workspace resource ID, rejects ungranted Agent launches, reports online state, supports local-to-local QUIC read/write, streams remote shell stdout/stderr with the final exit code, and authorizes paired-device desktop session/signaling/input/stats operations before Workspace routing. Unknown methods fail only their request; missing `desktop.control` does not disable Workspace features. | Windows native Thread adapter plus cross-platform Rust |
| Synthetic channel packages | `bun run test:fixtures` | Lowercase plain-text ingress is preserved, outbound/progress delivery succeeds, final Markdown updates the progress message in place and ignores late partial updates, and the WebSocket pong watchdog is present so half-open connections reconnect | Windows, macOS, Linux |

## Suites

- `package`: validate only package integrity.
- `core`: package integrity, Thread surface, and full native CDP.
- `full`: package integrity plus packaged-SPA coverage and every native adapter, serially.

`--require-native` turns a missing platform adapter or unavailable desktop into a release-gate failure. Without it, the runner prints `SKIP` and exits based on completed layers. This makes the same driver useful on developer machines while allowing each platform CI lane to demand its own native coverage.

## Candidate build contract

1. Snapshot the existing Tuffite release output; do not run Chromium configure/build during an application smoke cycle.
2. Verify the Embedder Distribution manifest and hashes.
3. Build Ovule Web assets and Rust runtime.
4. Package to a fresh candidate directory and archive name.
5. Run source, package, core, and platform-native layers.
6. Promote only the exact verified candidate. Preserve the previous formal package as a backup and regenerate the archive from the promoted directory.
7. Record package file count, archive size, SHA-256, platform, Tuffite profile, and smoke results.

## Adding another platform

Place a Node adapter under `desktop/smoke/` and add it to `ADAPTERS` in `scripts/run_smoke.py`. Add genuinely Windows-only native APIs or executable fixtures to `WINDOWS_ONLY`. Keep step names and evidence semantics stable across platforms. An adapter must:

1. accept the package root as an explicit argument;
2. create an isolated user-data and Ovule data directory;
3. never kill unrelated application processes;
4. clean up its owned processes on success and failure;
5. print a stable `<step>=ok` evidence line;
6. preserve or report artifacts when it fails.

Keep the package directory immutable. Redirect browser logs and user data into
the adapter's isolated run root. The Windows desktop-shell adapter may retry a
failed internal compositor capture once, but only in a new process and browser
profile; the second attempt must satisfy the same pixel assertion.

Do not claim cross-platform native parity until each release platform implements and passes all required adapters.

## SPA candidate checks

Package integrity requires the single HTML entry plus the generated React Router route chunks for main, thread, and pane. Thread and tool surfaces use `/thread` and `/pane` on the `-` host. `spa-workbench-smoke.mjs` covers artifact placement, sidebar children, title bar editing, pane retention and resizing in a stock browser; native Thread coverage additionally exercises actual Explorer guests. Legacy full CDP and desktop adapters must be migrated to tool guest targets before their results count as a SPA release gate.

Terminal coverage requires the Add tab flow to open a cwd dialog whose local `HOME`, Thread Workspace, and attached local or remote Workspace rows each open the terminal in one click. When Remote Hosts exist, the same Add tab menu exposes a Remote Host picker that opens the selected desktop, renders live WebRTC metrics, forwards a standalone Shift tap as USB HID input, and can close then reopen the pane with a fresh CRD session. The common visual contract also verifies the global 2 px Lucide stroke. Hosts coverage keeps Open desktop as a 28 px icon-only action with a tooltip, and the Rust contract verifies paired-device authorization for CRD signaling and input.

The `spa` suite runs package integrity, the packaged stock-browser Workbench and Workspace Center checks, Thread, stress, desktop shell, Explorer context menu/DevTools and root DevTools serially. It excludes the broader full native CDP adapter, so a SPA suite pass does not replace that release gate. The Explorer context-menu adapter now defaults to an isolated loopback fixture, avoiding external network dependency.

## Remote Control

Remote Control uses stable Link ALPN `ovule/link`, native capability `crd-webrtc`, application capability `desktop.control`, and named Link methods under `desktop.*`. Pair links and local authorization schema never decide network feature compatibility.

Run the lifecycle tests under `src/remote_control` and input/statistics/ICE diagnostics tests under `src/services/remote-control`. ICE policy is owned by the receiving Host: Client start requests cannot supply ICE servers; the Host uses one configuration for native CRD and returns it through encrypted Link for Client WebRTC. TURN REST shared secrets stay on the Host, preferably in an ACL-protected file; only device/session-scoped HMAC-SHA1 credentials cross Link. The ordinary Remote Control UI exposes no relay URL, username or password. Direct-only defaults use multiple independent STUN servers without presenting them as relays. Candidate diagnostics must distinguish a network that needs TURN, a TURN configuration that yields no relay candidate, and a failed path that did gather relay candidates; no URL credentials may enter diagnostics. The dual-instance adapter uses semantic `input-sequenced` / `pointer-latest` channels, renderer lease heartbeats, and asynchronous Stop verification. Required lifecycle cases include device ownership, revoked/expired sessions, bounded handshake lifetime, stale input disposal, congestion, and focus-loss release. A passing loopback smoke does not establish WAN performance or RDP/SPICE parity.

The native adapter also loads the shipped React SessionController and verifies its first frame, reconnection, and native keyboard input. Remote controls now live in the registered spice pane toolbar: the embedded session must have no duplicate header, and its native adapter exercises reconnect and transport-policy changes through the same pane-command events sent by the outer toolbar. Frontend rendering tests cover compact text selectors, connection-dependent action availability, workspace/workbench registration, sanitized toolbar metadata, and preserving live state during pane promotion without persisting it across restarts. Its focus helper only activates the explicitly supplied test package's Host PID. The stock-browser layer checks the native-required UI instead of fabricated latency values; standalone Shift and timing assertions belong to the native layer.

## Cross-platform core smoke

`python scripts/smoke_native.py --package dist/<candidate>` runs the selected
native package in an isolated profile, covers ShellAPI startup, Thread creation,
Agent onboarding (Codex extension sign-in, profile-local model selection, multiple
profiles, refresh retention and right-aligned actions using a fake Codex CLI and
provider credentials through the real backend on macOS/Linux; skipped on Windows),
including app-server OAuth URL placement and redirect retention in Workbench,
configured API Key collapse/expand,
Browser overlay mounting inside app-shell and closing (local fixture, including
the layout effect used by authentication navigation), extension Web modules
(including Message Block registration failures), Markdown
read/write, Workflow Node Threads, terminal execution and Settings scope, then
requires normal process exit and checks SQLite state after restart. It records
owned process IDs, exit durations and an evidence directory. The default shutdown
budget is 20 seconds; `--shutdown-timeout` is an explicit diagnostic override.
This core check does not substitute for Thread surface or CRD E2E adapters.

The native core smoke checks the Settings panel itself when Workbench is open;
its compact sidebar intentionally hides the Settings heading. Failed native
assertions preserve the main-page screenshot and HTML for diagnosis.

The native core suite verifies that pending Tasks and approval Gates have no Node
Thread, and that the interactive-ui extension loads a sandboxed frame and routes
an explicit choice through the compose bridge. Rust tests cover Task execution
context persistence, remote assignments, workflow Message Parts, setup blocks in
Node replies, and planning beyond six Nodes. Frontend tests cover persisted Goal
association and late renderer registration. No live Channel account is used.

Conversation continuity coverage in `core-native-smoke.mjs` verifies the configured
default Agent on a new conversation, stable Explorer element and document identity
across first send and Thread switching, absence of the startup loading surface,
and a focused inline Gate dialog without a legacy cleanup false positive. After
closing Workbench, it waits for responsive sidebar restoration through the Thread
guest toggle before asserting the main-page New Conversation action.

## Runner layout

All desktop smoke probes, fixture servers, and launchers live under `desktop/smoke/`. Run Node launchers with `--package-root`; `thread-surface.mjs --stress --stress-iterations 30` runs the stress probe. `scripts/smoke_crd.py` is the project-level Python gate. The suite runner uses Node on every platform and reports unsupported Windows adapters as skipped.

Windows native menu positioning, UIAutomation names and invocation, production root Inspect element, overlay screenshots, edge hit tests and mouse resize, and Host focus use `platform/windows/NativeProbe.cs`. The `.mjs` adapter compiles it with the Windows .NET Framework 4 compiler and WPF UIAutomation assemblies; no PowerShell is used. The deterministic ACP/Ollama executable fixtures also compile with that compiler. These suites require an interactive Windows desktop and remain Windows-only; macOS/Linux core coverage is additionally available through `scripts/smoke_native.py`. Generic SPA, thread surface, E2E, and exit launchers use Node and isolated profiles.

## Connection plugin package contract (2026-10-13)

Package integrity validates `manifest.json` schema_version 2 with the implicit `assets` root. Extension manifests and Host modules live under `resources/extensions`; browser modules alone use `resources/web/extensions`. Cloudflare connectivity manifest must be included, without management credentials. A credential API probe is not a media/NAT test: validate direct video and real relay video separately. Mac native/CDP and home WAN skips/failures must remain explicit.

### Official cf CLI setup card

`--suite connectivity` runs `cloudflare-setup.mjs` against an immutable candidate: actual /cloudflare catalog discovery, persisted custom Message Block with no Agent Attempt, invalid account rejection, shipped Web Component account selection, safe text rendering, and the shipped button dispatching the authorization-open action. Frontend unit tests independently verify the core action bridge requesting authorization in Workbench and suppressing navigation on invalid/error results. Cloudflare is absent from onboarding; native plugin tests also check PKCE link opening once and explicit reopening. Browser action events are intercepted during UI fixtures: this suite must not log in to Cloudflare or create real keys. Native CLI fixtures separately verify scoped login arguments, encrypted-store policy, cancellation, secret redaction and retry without duplicate creation. Real authorization and TURN media validation remain separate user-operated checks.

## Private channel restoration

Set `OVULE_CHANNEL_EXTENSION_ROOT` to an explicitly selected independent channel package when running `scripts/smoke_native.py`. Set `OVULE_SMOKE_SCOPE=channel-restore` to run only the channel restoration contract and restart check. The core adapter installs it into the isolated profile, verifies its declared slash command contributions, and invokes the binding action to check its host contract without a live account. Rust channel adapter tests cover persisted destinations, inbound routing, deduplication, invalid Thread rejection and clearing the override. Private channel packages are never bundled into the public application for this check.

## Thread navigation and extension locations

The core native adapter clicks New Conversation from an existing Thread, waits for the blank composer, sends its first message, and verifies that the Explorer document stays mounted. Standard Window MessageEvent request/reply routing is separately covered by shell tests, including origin checks, request correlation, synchronous send errors and command failures. Extension catalog metadata includes the canonical installation directory; the independent-package native check verifies that it resolves to the isolated installed copy rather than the source package.

Set `OVULE_SMOKE_SCOPE=conversation-navigation` for a focused native check that creates a Thread, verifies guest-to-root standard message replies, clicks New Conversation with Workbench open, checks the blank draft without replacing the Explorer document, displays the extension installation path in Settings, and verifies restart persistence. This scope does not run account onboarding.

Set `OVULE_SMOKE_CHANNEL_ACTIONS=1`, `OVULE_CHANNEL_WORKER_MOCK=1`, and `OVULE_CHANNEL_CARD_FIXTURE` to the bundled `channel-card-fixture.ts` probe with the navigation scope to exercise the shipped setup card and action bridge against an isolated native API. Supply the selected private worker’s mock-mode environment flag as well. Coverage includes empty Bot selection, visible transport errors and retry, background registration/status polling, configured refresh, and sending a message during registration. Authorization URLs are captured rather than opened; this probe must never use a live provider account. Rust tests additionally leave the worker queue unconsumed to verify nonblocking acceptance, duplicate suppression and queue saturation.

The channel card regression also hides the Bot selector for empty/pending-only connections. With `OVULE_LARK_WORKER_MOCK_MANUAL_AUTH=1`, authorization stays pending until the user clicks Refresh, proving the Host polls an unpersisted registration session and subsequently displays the authorized Bot. All credentials and authorization responses in this case are synthetic.


## Channel recovery regression

`node desktop/smoke/lark-channel.mjs --package-root dist/<candidate>` requires the
private `plugins/channel-lark` build (or `OVULE_CHANNEL_EXTENSION_ROOT`). It uses
an isolated profile, the actual Host card/action bridge, a local DeepSeek HTTP
fixture, and the private worker's mock transport. It verifies empty selectors,
visible errors and retry, pending authorization followed by Refresh, owner
`/pair`, Agent reply delivery, saved Thread binding, worker termination and
Refresh recovery, restart restoration, and 360 real ShellAPI requests. This is
protocol/lifecycle coverage; it does not certify live Feishu authorization or
production WebSocket delivery. Run it serially with other native adapters.

The full suite also invokes `core-native.mjs` on macOS/Linux, covering the
cross-platform Explorer, onboarding, workflow, resource and restart checks.
The Windows-only adapters remain separately reported skips on these platforms.
Stock-browser SPA adapters use Playwright's version-matched Chromium by default;
install it with `node desktop/node_modules/playwright-core/cli.js install chromium`
or set `OVULE_BROWSER` to a compatible installed browser. Rust source checks use
the runner's Python interpreter so they do not depend on a configured `python`
shim in mise.


For development-origin parity, launch a temporary copy of the same candidate
through `tuff dev --package <copy> --url <loopback-origin>/main --web-cwd <desktop>
--web-command bun --web-arg run --web-arg dev --web-arg=--port --web-arg <port>
--web-arg=--strictPort --devtools-port <cdp-port> --no-watch` from an isolated
directory without an application manifest, with a fresh `OVULE_DATA_DIR` and
`--app-arg=--user-data-dir=<profile>`. Run `hmr-cdp-smoke.mjs` with
`OVULE_CDP_PORT` and `OVULE_DEV_URL`. It verifies the actual Vite resource load,
360 successful native ShellAPI calls, and closes the test window through the
native window API. Browser/CDP disconnection alone does not close the application.

### Sustained thinking stream

Run `node desktop/smoke/thinking.mjs --package-root dist/<candidate>` to verify
a real native DeepSeek-compatible stream lasting 40 seconds. The isolated fake
provider sends 4,000 reasoning tokens while snapshot and catalog requests remain
responsive. Assertions cover uncapped thinking height, timeline following, manual
scroll detachment, and automatic collapse after completion. This adapter uses no
private Channel package or production account.

For the development-origin variant, launch a fresh candidate with the pinned CLI
and Vite, set `OVULE_SMOKE_SCOPE=conversation-navigation`,
`OVULE_SMOKE_THINKING_STREAM=1`, and `OVULE_DEV_URL` to its HTTP origin, then run
`desktop/smoke/core-native-smoke.mjs` against that launch's CDP port. It asserts
the native bridge, Vite resource and SQLite database. Resolve Bun with
`mise which bun` and pass its actual executable plus an explicit desktop `--cwd`;
a mise shim may resolve the repository development task instead of the Vite script.

### Guided Lark Gates

The private Lark adapter additionally mounts the current guided Gate presentation in the native renderer using isolated status fixtures. It verifies the Workbench authorization action after asynchronous registration, automatic recognition of existing authorization and valid credentials, the complete `/pair CODE` command, pairing-based continuation, and explicit selection when multiple bots exist. These UI fixtures complement the real backend/mock-worker pairing and delivery checks; they do not exercise a live Feishu account.

The guided Gate fixture also requires an explicit continuation button when bot identity/status detection fails. Confirming a human-completed Gate must advance exactly once while leaving the connection error evidence unchanged. Current Gate status and prerequisite-step status are presented separately.

### Real SDK pairing transport

The private Lark adapter first runs `plugins/channel-lark/smoke/sdk-transport.mjs` against a loopback HTTP/WebSocket service using the production SDK configuration. It requires tenant-token authentication, bot identity resolution, a protobuf `im.message.receive_v1` private-chat `/pair` event, a reply to that original message, a subsequent prompt/reply and duplicate-event suppression. A separate 21001 access-policy denial must prevent bot identity/connection establishment. The native mock-worker layer explicitly requires the host's Chinese pairing-success confirmation to target the original `/pair` message before verifying the actual fake-provider reply. The Gate fixture must hide a pairing command when disconnected and show the access-policy remediation. These remain isolated tests; a denied live tenant token is an external blocker, not a passing live pairing test.

The guided Gate native fixture requires Reject and manual continuation to share one footer and have the same top coordinate. It invokes Reject and checks one rejection, keeps the 21001 explanation as a single concise alert, and requires technical error details to be collapsed by default.

### Native Explorer handle migration

The core native overlay probe types into a local email form with actual mouse/keyboard input, promotes the live page to Workbench, and verifies the same document ID and preserved form value. It types again after promotion to exercise focus routing. No real Cloudflare login or provider credentials are used.

Set `OVULE_SMOKE_SCOPE=explorer` with `core-native.mjs` to isolate overlay form
input, Workbench promotion, native handle transfer to an independent window,
normal shutdown, and profile persistence after restart. The independent receiver
must retain the source document ID and show no transfer alert.

The Cloudflare card adapter also requires the configured phase to hide login,
use a read-only status refresh and remain configured after component remount.
Its fixture records actions to ensure completion does not start another login.

Manual Cloudflare status refresh coverage includes an explicitly delayed result:
the button must show a disabled refreshing state, completion must be visible,
and an error must expose an alert and allow a successful retry. A configuration
status refresh must not claim successful TURN/media delivery.


## Remote Host Add tab regression (2026-10-20)

`--suite remote-host-menu` creates an isolated Host inventory entry using the test process's own Link address, without pairing or granting desktop access. It verifies that Manage Remote Hosts is absent from Add tab, menu width follows the longest label, narrowing the conversation container constrains the menu and ellipsizes the label while icons stay 16px, and clicking the Host opens a `kind=spice` pane with the encoded remote-control target instead of a browser search. Screenshots record wide/narrow layouts. This checks pane navigation, not desktop capture or WAN video. Frontend tests exercise the exhaustive pane-kind check on the Thread-to-root message boundary.


## Debug/release coexistence

On Windows, validate two distinct immutable candidate packages with:

```sh
node desktop/smoke/build-channels.mjs --debug-package dist/<debug-candidate> --release-package dist/<release-candidate> --keep-run-root
```

This runner reads each package's executable from its manifest, starts both apps
simultaneously with independent synthetic application/browser profiles, checks
project isolation and restart persistence, and pairs both directions using actual
Ovule Link approval codes. Each client registers the other build as a remote Host,
binds an explicitly shared Workspace, reads a Markdown file, writes it remotely,
and checks the Host filesystem. Revoking the Workspace grant must reject reads
through an existing binding; restoring it must restore reads. Native default
Framework data/cache paths and Link public identities must differ. Screenshots
and a structured report are retained under both run roots. It uses no live provider
accounts, production profiles, or desktop-control credentials. Default profile-path
selection is checked separately with the platform crate in debug/release builds;
these native fixtures explicitly override application data to protect real profiles.

## Harness contracts and native trajectories

`python3 scripts/harness_eval.py --repeat 3` executes production Skill/Memory/
assembly contracts and writes a versioned JSON report. `--baseline <report.json>`
fails on a formerly reliable case becoming failed/skipped; dataset changes require
an explicit new baseline. `--adapter <json>` accepts external model graders using
the documented result schema; deterministic fixture results never imply model quality.

`--suite harness` invokes `harness-native.mjs` serially on a fresh immutable
candidate. The isolated local Provider chooses calls from real tool outputs:
Skill discovery/activation/resources, Memory across process restart, actual Explorer
form mutation, stale-ref rejection, typed Browser/CRD screenshots reaching the
Provider and durable body-free telemetry. Missing capture permission is a skip
and nonzero exit, never pass. Computer coverage is capture/media transport, with
no physical input injected. Browser input uses synthetic DOM events.

`python3 scripts/harness_eval.py --suite native --package-root dist/<candidate>`
repeats the suite and retains per-case reports, trajectory metadata and screenshots.
`--browser-placement overlay|sidebar|workbench|window` qualifies the masked
Explorer surface and its three promotion targets. A page marker must survive
native handle transfer, and subsequent tools/takeover must use the receiver.
The overlay probe asserts inner bottom-corner radii and feedback clipping;
promoted surfaces must use a shared alpha mask and pass real lower-corner
pixel comparisons before and after boundary halo activation.
The feedback rectangle must match its viewport below the toolbar, including
independent-window class replacement and screenshot device-scale handling.
`smoke:control-feedback` additionally compares composited corner pixels for
symmetric/asymmetric radii and halo clipping. Native placement runs are serial.
This does not validate remote ACP context, semantic recall, WAN quality,
cross-origin iframe input, native file pickers, desktop overlays or model planning.


## Agent admission and extension authorization (2026-10-25)

`bun run --cwd desktop smoke:agent-approval` runs the production approval UI in an
isolated stock browser: queue, one-shot correlated answer, inert arguments, Escape
deny, host cancellation and teardown denial. It does not validate the native bridge.
The native Harness suite additionally requests a Computer move with coordinates
omitted, denies it in the host dialog, and requires a denied tool result plus durable
approval telemetry (`approval.native`). Even an incorrectly admitted malformed call
cannot inject physical input. This does not grade actual desktop input success.

Rust Agent/Hosts/Storage tests cover fail-closed unavailable approval, forged/reused
IDs, cooperative cancellation settlement, extension-owned auth protocol, actual
macOS sandbox workspace writes/outside reads/writes/network denial, and journal
restart/duplicate identity/settlement. Loopback tests require an environment which
permits local listeners. A sandbox startup failure is FAIL, never isolation success.

The approval grader waits for persisted `harness/approval: pending` before its
UI deadline; time spent processing a provider response or budgeting large media
must not be misreported as a missing dialog. `harness/execution` records admission
and settlement separately. History sizing caches each message's bounded JSON size
and counts media bytes without retaining another JSON buffer; exact byte-boundary
and large-image regressions run in the Agent tests. This is not token budgeting
or semantic compaction.

## Isolated local preview entry and responsive Office (2026-10-30)

All application-owned modules, including Root, Providers, service composition,
state sync and routes, live under `desktop/src/app`; local renderers live under
`desktop/src/preview`. A single Vite config and `build.rollupOptions.input` build
`index.html` and `preview.html` together, without a mode or React Router framework
plugin. React Router remains the application's client router. Development URL
rewrites cover main/thread/pane/explorer and the local HTML entry. Package checks
require distinct HTML entry scripts. Local previews never initialize the
application Providers or service graph.

`local-files-native-smoke.mjs` issues real host grants and opens a distinct
`ovule://<grant>.local` origin. It requires raw path reads, directory listing,
grant minting, Workspace snapshots, unknown grants and paths used as grant IDs to
be denied in the guest. Only the Preview interface is granted. Office worlds
use exact dynamically registered origins; framework Chromium is reused unchanged.
Grants are canonical-file-bound, revocable and expire; host source-loader tests
cover superseded asynchronous grants. Appearance and measured pane dimensions
are passed from the host, including after native handle handoff.

The native adapter waits for the Office renderer's completion/error callback,
then checks DOC/DOCX/XLSX/PPTX, Markdown, unsupported archives and oversized states.
It also renders local PDF pixels and resizes its pane. The browser resources
adapter checks 420/700/1000px Office layouts, Word page fitting, sheet-owned
horizontal scrolling, PPT canvas growth, mixed plain/rich shared strings,
extended worksheet names and real merged cells. Optional
`OVULE_LOCAL_XLSX_SAMPLE=/absolute/workbook.xlsx` exercises a reported workbook
locally without modifying it. Generated fixtures remain the default gate; an
optional user sample is not a portable fixture or a live-data requirement.

These focused suites do not certify full release coverage, native history across
revoked grants, every third-party Office layout or non-macOS legacy DOC conversion.

HTML workspace snapshots now use `src/preview/html` instead of an app route or
shared localStorage. A host-only method validates the Thread workspace path and
issues an immutable, bounded HTML grant. The local renderer reads only its grant
and mounts the sanitized document inside an opaque sandboxed iframe. Browser
coverage preserves content/styles and rejects scripts/events; native coverage
rejects an existing HTML file outside the Thread workspace and guest-side grant
minting, then renders the allowed snapshot. Persisted HTML recipes reissue scoped
grants rather than persisting ephemeral origin IDs as navigation targets.

## Preview navigation and document display controls (2026-10-30)

File and web history belong to Chromium's NavigationController. The application
retains its Explorer instead of rebuilding it for file selections, and grants
remain valid across navigation until owner cleanup (or bounded native expiry).
The experience adapter models the native methods and checks YAML to ZIP, back
and forward. The native adapter reads both files again after real back/forward.
Loader tests check retained grant lifetime and revocation on owner cleanup.
Sidebar tests cover themed code-language artwork, stale web favicons, encoded
paths, native preview URLs and remote URL lookalikes.

Generic `@ovule/ui` no longer exports file breadcrumbs, preview states, language
detection or a navigation stack. Browser owns file breadcrumbs and their CSS;
the preview entry owns renderer states and styles. `@ovule/file-types` shares
pure file-language detection without application services or React.

The resources adapter exercises Word/PDF fit-width, fit-height, two-page layouts
and page navigation with multipage fixtures. Controls resize existing content
without rereading source files. PDF frames commit only after a complete render,
so cancelled resizes preserve the visible bitmap. Native local-files coverage
checks both documents' display modes and pager. The Word probe uses CDP to inspect
the extension's closed Shadow DOM; production isolation remains unchanged.

Word/PDF now use collapsible left-side page thumbnails instead of numeric pager
inputs. The resources adapter checks thumbnail navigation, selected-page state,
collapse/expand and resized page fitting. Word clones visible page content into
inert thumbnail frames; PDF lazily renders small thumbnail canvases. Native probes
click actual thumbnail controls, including inside the closed Office Shadow DOM.
