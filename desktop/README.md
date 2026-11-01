# Ovule Desktop

The application lives at `ovule/desktop`, alongside Rust `src/`. Application composition lives under `src/app`; isolated document renderers live
under `src/preview`. Desktop owns routes, providers, registrations, and platform wiring.
`features/` has no umbrella package, scripts or TypeScript configuration. Desktop
owns common validation; each domain keeps its package manifest and exports.
Capability implementations live in the source-owning `features/*` packages;
reusable presentation lives in `@ovule/ui`. Public package entries contain
declaration contracts, `.token.ts` identities, and `.provider.ts` registration
functions. Only application composition imports providers.

`src/app/services.ts` composes scoped language/preferences services and domain state.
`src/app/snapshot-sync.ts` synchronizes native wire responses: stage all domain updates,
then notify subscribers, reject stale revisions, and reconcile sequenced output.
It holds synchronization metadata and writers, not a global application state store.
`src/app/state.ts` derives a route-level reader from domain services. Individual business
views declare only the domain tokens they need. Route services select view implementations.

`ScopeProvider` accepts a registry and owns its scope. Factories use `dependsOn`,
React boundaries use `useService`, and non-React composition uses `scope.get`.
`I18nextProvider` receives the scoped language instance; centralized locales are
owned by the language package. The pre-provider startup fallback has stable English text.

Generated ShellAPI types/schema live in `@ovule/shell-api`. Native adapters load
its `/register` entry lazily. Vite mounts the package schema at `/shell_api.js`, and
native assets continue to reference `desktop/dist/client`.

```sh
bun run --cwd desktop typecheck
bun run --cwd desktop lint
bun run --cwd desktop test:architecture
bun run --cwd desktop build
```

Thread selection is synchronized into one retained Explorer document. Creating a
conversation and switching Threads update selection without rebuilding the route
or displaying the startup loader. Composer drafts belong to their Thread (including
the unsent new conversation); completing a send clears only its source draft.
New conversations prefer the configured default Agent, then an enabled profile
available on the selected Host. Explicit valid selections take priority.

## Workspace layout

The repository root owns the Cargo workspace. `desktop/` owns the Bun workspace, lockfile, feature and infrastructure packages, bundled extensions/plugins, skills, toolchain catalogs, and web build scripts. Run web commands from `desktop/`, or use `bun run --cwd desktop <script>` from the repository root.

Vite stages distributable extensions, plugins, skill files and the toolchain catalog in `dist/resources/`, alongside the Web `dist/client/` output. Browser extension modules retain `/extensions/...` URLs; native host files stay on disk with their executable modes. `bun run build:resources` prepares the same tree before native development packaging. `tuffite.json` bundles that tree and exposes only its browser subtree through `app.assets`; Rust resource providers resolve the packaged tree before development sources. Installed toolchain binaries remain in the user data directory.

```text
dist/
  client/                       # React Router assets
  resources/
    extensions/<id>/            # Validated manifests and distributable runtime files
    plugins/<id>/               # Packages available for explicit installation
    skills/<id>/                # Bundled Skill directories
    toolchains/registry.json    # Catalog; installed binaries remain in user data
    web/extensions/<id>/        # Browser-only projection for app.assets
```

Resource staging is one shared operation used by the Vite client build, Vite dev
server, and `build:resources`. It preserves package-relative paths and executable
permissions, excludes source trees and `node_modules`, and validates contributed
runtime files before copying. The browser projection contains only `dist/web`
files; native executables, manifests, and Skills are never exposed by that mount.
Custom React Router output directories receive a sibling `resources/` directory.

## Application frame and message parts

`@ovule/framework` owns the entire application frame: TitleBar, overlays and
layout. The route composition supplies `ContentView` through its `contentView`
token. `@ovule/message-parts` owns the handoff protocol, runtime and pane in
addition to message renderers; handoff implementation lives under `src/handoff/`.
Application, main, thread and pane providers keep their original scope lifetimes.

`eslint-plugin-boundaries` enforces feature and application imports. Features can
only consume another feature's exported type declarations and token identities.
Only application composition imports providers; no application view reaches a
feature implementation. Small manifest validation checks public export targets
and forbidden ownership dependencies without scanning source dependency graphs.

The UI has two HTML entries in `vite.config.mjs`: `src/app/index.html` owns the
application client router and service composition; `src/preview/preview.html` owns
isolated file renderers, including workspace HTML snapshots. One Vite build emits
`dist/client/index.html` and `dist/client/preview.html` through
`build.rollupOptions.input`, with no build mode or React Router framework plugin.
The preview entry does not initialize application Providers. Development routes
`/main`, `/thread`, `/pane` and `/explorer` resolve to the app HTML entry.

File preview states and renderer styles belong to `src/preview`. The browser
domain owns file breadcrumbs and publishes their view through its route runtime.
`@ovule/file-types` shares pure file-language detection with the host and sidebar;
`@ovule/ui` keeps generic UI primitives. File selection calls the retained native
Explorer's `load`; Chromium owns back/forward, while file grants remain valid
until their Explorer owner closes.
