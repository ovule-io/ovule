# Ovule Features

`desktop/features/` is a workspace of source-owning npm packages. Desktop owns routing,
registry composition, transport synchronization, and scope lifetime. Business code
uses the consumer IoC API and never imports its container, bridge, or desktop.

## Package ownership

- `framework` owns the application frame: TitleBar, overlays, two-column layout,
  responsive ConversationLayout, panel widths, and visibility. Desktop supplies
  the routed `ContentView` through the `contentView` token. `sidebar` owns thread navigation and the thread-switcher
  dialog; `omnibox` retains its navigation surface.
- `conversation` owns threads, selection, ConversationView, ThreadSurface,
  composer, message timelines, renderer registry, and message diagnostics. Its state files live directly in `src/`.
- `panes` owns shared pane definitions/registry, instances, tab activation and movement,
  WorkspaceToolbar, WorkbenchToolbar, and PaneSurface. Conversation and workbench
  consume `workspaceToolbarView` and `workbenchToolbarView` separately. The former
  resolves pane-specific chrome from `PaneDefinition.workspaceToolbar`; the latter
  owns tab indicators, the tab menu, and workbench expansion. Shared toolbar state,
  controls, editors, and new-tab dialogs live in separate modules. `paneToolbarView`
  remains a compatibility dispatcher. A pane can appear in either location.
- `workbench` owns only the right-hand presentation area. It consumes the shared
  panes service; it is not the name of the shared container mechanism.
- `workspace` owns project/workspace bindings, paths, domain state, and the native
  workspace facade. It has no conversation view, pane state, or layout implementation.
  Desktop owns application lifecycle effects and transport synchronization.
- `files` groups local file browsing, Markdown viewing/editing, and extension file editors.
  Browser, terminal, remoting, and workflow retain their own domains.
  Human handoff belongs to `message-parts/src/handoff/`.
- `workflow` owns Goal/Node/Attempt state and graph/activity presentation; a workflow
  pane is one presentation of that domain.
- `settings` owns agent/model/tool/skill configuration, onboarding, application
  preferences, and extension catalog/management. Its preferences retain application
  lifetime, and extension catalogs retain thread lifetime.
- `conversation/messages` owns timelines and rendering orchestration. `message-parts`
  owns renderer extensions, interactive host elements, handoff protocol handling
  and handoff panes.
- Hosts, language, and shell transport retain their packages.

Each package lives under `desktop/features/<package>/src`, owns its implementation,
styles and tests, and declares the dependencies it consumes. Related capabilities
inside a package may share private implementation directly.

Message part rendering separates list orchestration from Markdown and attachment
renderers, extension module registration, Web Component mounting, fallback/reasoning
views, and pure asset/link utilities. The public message-parts provider composes these
private modules; it preserves the same runtime token contract.

## Public contracts and composition

Each source-owning package publishes one token entry named
`@ovule/<package>/<package>.token`, backed by `src/<package>.token.ts`.
A package with one registration boundary publishes
`@ovule/<package>/<package>.provider`. Packages with multiple lifecycle scopes
publish exact entries such as `app.provider`, `main.provider`, `settings.provider`,
`thread.provider`, or `pane.provider`, each backed by the same filename in `src/`.
Providers accept the registration callback and scope-specific configuration;
composition chooses the scope by import path rather than a runtime discriminator.
Package providers and scope providers cannot be mixed. Packages with no registration
work may omit providers. Token aliases, provider aliases, nested public providers,
and implementation barrels remain private.

Declaration exports remain an explicit whitelist with only a `types` condition;
no implementation, stylesheet, or locale JSON is public. The package token module
groups its owned token identities; the package provider composes its private
registration helpers. Registration helpers are private functions in the provider; larger implementation
helpers may remain ordinary private `.ts` modules within the same package.

Across business packages, imports resolve only to `.d.ts` contracts with `import type`
or `.token.ts` identities, through the owning package name and an exact whitelisted
export. Relative paths and aliases cannot bypass that public surface. Token modules have a single `export default tokens({...})`
and no named exports or re-exports. Declarations contain types/interfaces and consume
other declaration types. Package boundaries apply to aliases, relative paths,
re-exports, `require`, and dynamic imports, including tests.

A `.provider.ts` module has one default registration function and no named exports,
re-exports, or module-level factory calls. Only desktop composition imports providers.
The first parameter uses the consumer-side `Register` contract and the synchronous
function explicitly returns `void`; the provider registers private
factories without depending on container ownership:

```ts
import type { Register } from "@ovule/ioc";
import workspaceTokens from "./workspace.token";
import { createStateService } from "./state-service";

export default function registerState(register: Register): void {
  register(workspaceTokens.workspaceState, () => createStateService());
}
```

Desktop passes its registry registration callback, composes providers, and owns
scope disposal. Views and ordinary consumers resolve tokens through `useService`
or captured `DependsOn`; `scope.get` belongs to composition and integration tests.
Generic presentation lives in `@ovule/ui`; observable subscription helpers live
in the consumer IoC API.

Desktop owns the shared TypeScript configuration, ESLint configuration and checks.
`features/` is an organizational directory, without its own npm package or scripts.
`eslint-plugin-boundaries` enforces source dependency edges; ESLint syntax restrictions
enforce token, provider and declaration forms. A small manifest check validates
public export targets and forbidden ownership dependencies; TypeScript checks
declaration semantics. There is no custom source dependency scanner.
Computed imports are confined to `shell/src/load-external-module.ts` for validated
host assets.

## Feature registration review

All 18 packages use one canonical token entry. Providers follow the scope columns
below: composition imports the corresponding scope provider where several scopes
exist, and a simple package retains one provider. Instance lifetimes remain distinct. Layout and pane state have separate owners. Moving a
pane changes its placement while preserving its ID and navigation state. Existing
`ovule.workbench.*` storage keys remain compatible.

| Package        | Registration scope    | Ownership reviewed                                                            |
| -------------- | --------------------- | ----------------------------------------------------------------------------- |
| browser        | app, pane             | Route runtime and pane definition                                             |
| connected-apps | main                  | Connected app views                                                           |
| conversation   | app, main, thread     | State/selection; conversation view; thread-local composer and message runtime |
| files          | pane                  | Local files, Markdown and extension file editor definitions                   |
| framework      | app, main             | Application frame, TitleBar, overlays, layout and content slot                |
| hosts          | app, settings         | State controller and settings view                                            |
| i18n           | app                   | Independent language service instance                                         |
| message-parts  | app, thread, pane     | Renderer runtime, handoff protocol and pane                                   |
| omnibox        | main, pane            | Same view bindings installed in either scope                                  |
| panes          | app, main, pane       | Toolbar runtime; shared instances/surfaces; pane registry                     |
| remoting       | app, pane             | Remote control/links and pane definition                                      |
| settings       | app, settings, thread | Controllers, onboarding, preferences and thread-local extension catalog       |
| shell          | app                   | Transport/runtime; desktop supplies snapshot synchronization                  |
| sidebar        | app, main             | Thread-switcher dialog independent of sidebar visibility; sidebar view        |
| terminal       | app, pane             | State controller and pane definition                                          |
| workbench      | main                  | Right-hand pane presentation                                                  |
| workflow       | app, thread, pane     | State/runtime; presentation in thread and pane                                |
| workspace      | app                   | Project/path/binding state and workspace facade                               |

## Domain state and transport

Each domain owns an observable state service. Desktop stages all domain updates
before notifying subscribers, rejects stale revisions, and applies agent stream
updates coherently across workflow and conversation. Pending operations and errors
are tracked by affected domain. A view declares the domain tokens it reads; its
projection is a cached derived reader, not another authoritative store.

`AppSnapshot` is a generated wire DTO used by the mock adapter and shell synchronization.
View contracts use capability-owned data projections. Operation contracts narrow the
native API to the methods relevant to their capability; snapshot-returning native
commands remain a transport compatibility requirement. Desktop performs the batching.

`I18nService` owns an independent i18next instance per scope, centralized locales,
language preference, subscriptions, and cleanup. React receives the instance through
`I18nextProvider`; custom element renderers receive it explicitly. Preferences owns
appearance state. Reading browser settings and wiring platform listeners happens in
application composition, not module initialization.

## Validation

Run these commands from `desktop/`.

```sh
bun run typecheck
bun run lint
bun run test:architecture
```

## Agent onboarding

Onboarding is a single Agent configuration surface. Each selected Agent owns its
setup card and readiness indicator. Extension Agents (including Codex) render
the extension's contributed installation and authorization actions; their model
selection belongs to the extension. Ovule profiles each own a provider and
model selection, including newly added profiles. Provider setup may be shared
account state, but model selections and unsaved form values stay profile-local.

Continue requires at least one selected Agent, a selected default, authenticated
ready extension Agents, and an available model for every Ovule profile. A
refresh preserves in-progress selections. There is no global provider/model
wizard or hidden active profile. The native core smoke checks this UI with
an isolated fake Codex CLI and provider credentials; it does not authenticate real accounts.

Codex Agent installation is separate from account authorization: the installation
action prepares `codex-acp` and its dependency Toolchains, while ChatGPT sign-in
starts a managed `codex app-server` login session. The backend returns its OAuth
URL to the view, which opens a Workbench browser tab with in-tab navigation.
Installation progress and account authorization waiting are explicit; stopping
the UI wait does not abort an installation or invalidate an ongoing login.
Configured secret fields and their save actions are collapsed until the user
chooses Update API key; secrets are never read back into the view.

Workflow Message Parts associate a live Goal card with the Agent reply that
created it. Message renderer registries notify subscribers when asynchronous
extension registration finishes. Agent-authored `interactive-ui` HTML is hosted
by the host iframe renderer for the visuals extension in an opaque-origin iframe; its compose action
fills a reviewable follow-up draft. See [Goal and UI contracts](../../docs/goal-and-workflow.md).

Workflow Gate clicks open a focused requirements dialog in the conversation.
The dialog lists prerequisite states and exposes Approve/Reject only while the
Gate is waiting. Gates have no conversation Thread and do not need one to be
resolved. The Workflow header remains the entry point for the full plan.

Active Goals use a compact pinned Workflow card. The collapsed card exposes live
Agent activity, waiting reasons, direct Gate review, the latest step result and
an Open configuration shortcut. Task logs and interactive setup blocks render in
Node Threads; parent Threads retain the Goal-level summary and persisted setup
Node reference. Sidebar navigation nests materialized Node Threads and their
artifact tabs under the parent conversation. Markdown answers render in full,
with a compact heading scale. Installed Skill commands in the composer open read-only
`skill:<id>` Markdown views.

Workflow graphs belong to their parent Agent reply. The separate draggable activity window and Workflow tab share concise activity rows; host-owned Channel setup cards supersede model-authored duplicates within a reply. Node Threads and their tabs share one Sidebar child level with fixed-size icons.

Conversation artifact indicators include tabs owned by sibling Workflow Node Threads. Selecting an indicator selects its owning Thread before activating the artifact. Sidebar artifact rows expose the same move-to-Workbench and close actions at either ownership level; closing an artifact does not delete a persistent Node Thread.

Workflow graph nodes share a compact height, with a two-line title and one metadata line. Results stay in the Node Thread and activities rather than changing the graph geometry. Streamed reasoning uses a separate Trace above the answer, expanded during reasoning and collapsed when the answer starts unless the user has manually toggled it.

Conversation rendering follows the [shadcn AI Elements patterns](https://ui.shadcn.com/docs/ai-elements),
adapted to the existing Radix primitives and Ovule theme tokens in `@ovule/ui`.
`ConversationMessage` owns Message header, role layout, user Bubble, and footer;
Message Scroller owns thread navigation. `Reasoning` and Workflow activity lines
share Trace, while the Workflow graph and Gate actions retain their domain behavior.
Prompt Input composes a form, Input Group, Attachment, and a busy-aware submit
button. Composer services retain draft, paste, command, workspace, and Agent state.
Streamdown still owns Markdown and code rendering; extension blocks retain their
registered sandbox renderers. Tool diagnostics remain backed by real telemetry,
with no inferred tool steps or invented durations in the message presentation.
