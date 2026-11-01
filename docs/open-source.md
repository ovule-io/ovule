# Open-source preparation and standalone builds

## License scope

Ovule-owned source code and documentation use `MIT OR Apache-2.0`: recipients may
choose either license. `LICENSE` contains both texts. Original upstream licenses
continue to apply to third-party code and artifacts. Package metadata must use
the same SPDX expression; generated third-party notices retain upstream copyright.

## Standalone checkout

The outer Chromium workspace and a separate SDK checkout are optional. Cargo
fetches the Tuffite Git revision pinned in `Cargo.toml`; Mise installs the CLI
at the same commit, and Bun installs the matching JavaScript SDK through its
`git+https` dependency. Install Rust 1.91.0 (also pinned by `rust-toolchain.toml`), Bun 1.4.2,
Node.js 22.22.0 and Git LFS, or use `mise trust` and `mise install` for the pinned
toolchain. Python is needed for legacy maintenance scripts, not daily development
or packaging.

Clone this repository:

```sh
git clone <ovule-repository-url> ovule
cd ovule
git lfs pull
bun run install:desktop
bun run build
bun run package
```

The same Bun commands work on Windows. `scripts/tuff.mjs` resolves the pinned CLI
from Mise and applies application-specific environment overrides.
`OVULE_TUFFITE_DIR` optionally selects a local
SDK for Framework/application co-development; the default uses the locked Git SDK.

With tools installed directly, run the Web dev server using
`bun run --cwd desktop dev -- --port 5173` after building. Native development also
needs the matching packaged Framework and the `tuff dev` launcher. The pinned
macOS x64 runtime can be explicitly selected with `TUFFITE_FRAMEWORK_DIST`;
other platforms need a compatible released or locally built Distribution.

The SDK repository was reachable and the pinned Git revision resolved on the
development host. Private repositories still require Git credentials. Native
Framework availability remains separate; use Git LFS for vendored artifacts or
a compatible Framework Release. These commands do not publish either repository.

## License generation and distribution

- `bun run --cwd desktop build:extensions` generates each extension/plugin's
  `LICENSE` and `THIRD_PARTY_NOTICES.txt` from exact bundler inputs. Missing license
  text is a build error. npm file lists and native resource staging include them.
- Office uses ExcelJS and JSZip source entries rather than their prebundled entry
  points. PDF.js embeds core-js; the exact upstream license snapshot is retained
  under `desktop/packages/ovule-extension/build/license-overrides/`. Embedded upstream copyright/license
  comments are retained in generated notices. Review prebundled upstream modules
  and supplements when changing pinned dependency versions.
- Production frontend builds generate their own input-based notices inside
  `desktop/dist/resources/licenses`. This directory is included in native packages.
- Framework Distributions must include hash-declared, nonempty
  `runtime/licenses/LICENSE.tuffite.txt`, `LICENSE.chromium.txt` and
  `THIRD_PARTY_NOTICES.chromium.txt`. `scripts/vendor_framework.py` rejects imports
  without them. Generate them from the matching Chromium GN graph, strip staging
  copies with the Framework packager, and verify before importing.
- `bun run package` additionally generates native application Cargo notices
  through the `notices` Mise task before packaging. Daily development skips this
  step; regenerate after dependency changes when distributing a new package.
  The locked graph is a
  conservative superset including build/test dependencies. Missing upstream texts
  fail the step; reviewed exact-version supplements are stored in
  `scripts/license-overrides/rust/`. Review source/relinking obligations separately
  for any dependency that requires materials beyond license notices.

## Publication checks requiring a release decision

The current source preparation leaves Git history untouched. The existing initial
commit uses a corporate email, and its LFS pointers still reference the previous
unstripped Framework. Adding a new commit does not erase either. Choose the public
Git author identity and prepare a reviewed publication history before publishing;
do not mirror local stash references or upload private symbol archives.
The local `dist/ovule-open-source-review.tar.gz` review snapshot contains current
source and the sanitized vendored runtime, with no `.git` history or local build
caches. It can be reviewed as a clean publication snapshot while the original
working repository and its history remain intact.

Confirm that all code can be licensed by its contributors. The choice of an
SPDX identifier does not establish ownership or employer permission.

The native build configuration used by the current runtime enables FFmpeg Chrome
branding and proprietary codecs. Its notices include FFmpeg's upstream materials;
notices alone do not establish codec patent permissions or satisfy every applicable
source/relinking obligation. Review the matching FFmpeg build, corresponding source,
Chromium/Tuffite changes and distribution terms before public binary releases, or
produce and validate a separate runtime with the required codec policy.

Source paths, runtime data and credentials should not be committed. `.gitignore`
excludes common credential and diagnostic files, but ignored files already tracked
by Git remain tracked. Scan the exact branches/tags and LFS objects selected for
publication again after the release changes.
