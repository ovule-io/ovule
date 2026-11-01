# Contributing to Ovule

Follow [local development](docs/local-development.md) to install the pinned tools
and select a compatible Tuffite Framework. Keep machine-specific paths in ignored
`mise.local.toml`; do not commit local SDK overrides, credentials, captures or data.

## Formatting and Zed

Open the repository root in Zed after `mise install` and `mise run install`.
The project settings in `.zed/settings.json` use rust-analyzer for Rust formatting;
`desktop/.zed/settings.json` selects Zed's Prettier integration for frontend files.
Rust and frontend source files format on save. Other languages keep manual
formatting so an unrelated formatter does not rewrite existing files.

- Rust uses stable rustfmt from Rust **1.91.0**, edition and style edition **2024**,
  four spaces, 100 columns, and default small-item heuristics. `rustfmt.toml` is the
  shared CLI/editor authority. No nightly formatting options are required.
- Zed's rust-analyzer formatter explicitly runs `rustup run 1.91.0 rustfmt` to
  avoid picking a different Homebrew/system formatter from `PATH`. Install the
  pinned toolchain and rustfmt component, and ensure `rustup` is on Zed's `PATH`.
  Update this override together with `rust-toolchain.toml` and Mise when upgrading.
  The Cargo helper also resolves rustfmt through rustup using the toolchain file.
- Frontend formatting uses the installed Prettier **3.6.2** and
  `desktop/.prettierrc.json`: two spaces, 100 columns, double quotes, semicolons
  and trailing commas. Install desktop dependencies first so Zed can find the
  project's Prettier. `.editorconfig` supplies shared indentation and LF endings.
- Generated `dist/` bundles and ShellAPI bindings are excluded by
  `desktop/.prettierignore`; regenerate them through their build tools.
- Follow the existing formatting scope. Root maintenance scripts, Markdown and
  generated assets are not part of the desktop formatting command. Avoid unrelated
  whole-repository rewrites when submitting a focused change.

```sh
mise run format:check
mise run format
```

The write command formats the workspace's Rust files and the desktop paths already
covered by `desktop/package.json`. Review its diff before committing. To format a
single Rust file with the pinned formatter, run `rustup run 1.91.0 rustfmt path/to/file.rs`
from the repository root.

ESLint also enforces custom dependency boundaries and AST selectors for declarations,
tokens and providers. Oxlint's default rules do not replace those checks. An Oxc
migration must preserve that coverage. Oxfmt can reuse the basic formatting options;
disable import and package-key sorting to minimize changes, compare its output and
switch the CLI and Zed together. See the official
[Oxlint plugin contract](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) and
[Oxfmt migration guide](https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier.html).

Zed's [formatter reference](https://zed.dev/docs/reference/all-settings#formatter)
and rust-analyzer's [formatter configuration](https://rust-analyzer.github.io/book/configuration.html#rust-analyzer.rustfmt.overrideCommand)
describe the editor integration used here.

## Validation

```sh
mise run public-source:check
mise run docs:check
mise run sdk:check
mise run check
```

`check` includes source-publication and documentation checks, Rust check/test/Clippy, and desktop
build/type/lint/test/format checks. Native app changes also need the relevant
[smoke checks](docs/local-development.md). Describe what you ran and any platform
limitations in your change description. Preserve the locked dependency graph;
update lockfiles intentionally when dependencies change.

The public-source check reads Git-tracked and unignored working-tree files,
including staged files that `.gitignore` would otherwise exclude. It rejects
optional private repositories, symlinks, common local credential filenames,
private-key headers, selected GitHub/AWS credential signatures and machine-specific
user paths. It reports
paths and reasons without printing matched secrets. For organization-specific
terms, use `python3 scripts/check_public_source.py --terms-file /private/path/terms.json`
with an untracked JSON list of nonempty strings.

These checks are a narrow publication gate, not a complete secret scanner,
dependency advisory audit or security certification. Review the exact Git refs,
LFS objects, ownership and binary licenses before publication; see the
[distribution guide](docs/open-source.md).

Documentation is English-only. Update the owning reference page in `docs/` instead
of adding dated plans or validation diaries. Keep package-specific instructions in
the package README and exact test evidence with its change or generated artifacts.
