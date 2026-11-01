# Open source and distribution

See [contributing](../CONTRIBUTING.md) for code checks and editor setup, and
[local development](local-development.md) for standalone builds and SDK selection.
The current source preparation does not approve a public binary release.

## License scope

Ovule-owned source and documentation use `MIT OR Apache-2.0`; `LICENSE` contains
both texts. Retain upstream licenses for third-party code and artifacts. Package
metadata must use the same SPDX expression. Confirm contributor ownership and
licensing permission separately from metadata.

## Standalone build

```sh
git clone https://github.com/ovule-io/ovule.git
cd ovule
mise trust
mise install
mise exec -- git lfs pull
mise run doctor
mise run prepare
```

Cargo, Mise and Bun select the same pinned Git SDK. Native builds additionally
require a matching Framework Distribution; no Chromium checkout is needed for
application-only development. Use `mise run package` for production output and
notices. Inspect runtime selection with `doctor`, including local overrides.

## Optional repositories and public source

Root `plugins/` is reserved for independent optional repositories. It is ignored
and excluded from dependency workspaces, default builds, resource staging and
source archives. Keep private remotes/credentials inside those repositories;
do not add private Git submodules. Each extension owns its build, tests, licenses
and provider documentation. Install its built package explicitly.

```sh
mise run public-source:check
python3 scripts/export_public_source.py --output dist/ovule-public-source.tar.gz
```

The checker enumerates tracked and unignored working-tree files, including tracked
credentials that `.gitignore` would otherwise hide. It rejects optional-repository
paths, symlinks, common local credential filenames and selected private-key,
GitHub-token and AWS-key signatures, as well as machine-specific user paths.
It reports paths/reasons, not secret values.
Supply `--terms-file /private/path/policy.json` to checker/exporter for an untracked
JSON list of organization-specific terms. Keep that policy outside public Git.

The exporter creates a SHA-256 file manifest and checksum without Git history,
build caches or ignored data. A working-tree archive does not sanitize branches,
tags, stashes, old LFS contents or previously uploaded artifacts. Review the exact
publication refs with a maintained secret scanner and dependency advisory audit;
the built-in signatures are deliberately narrow.

## Dependency notices

- Extension builds generate `LICENSE` and `THIRD_PARTY_NOTICES.txt` from exact
  bundler inputs. Missing license text fails the build. Preserve required upstream
  comments and reviewed supplements when updating prebundled dependencies.
- Production frontend notices are staged under `desktop/dist/resources/licenses`.
  Confirm that the final package includes them.
- `mise run notices` collects native Cargo notices; production packaging invokes
  it. The locked graph conservatively includes build/test dependencies. Reviewed
  exact-version supplements live in `scripts/license-overrides/rust/`.
- Framework Distributions need hash-declared, nonempty Tuffite/Chromium licenses
  and Chromium third-party notices. `scripts/vendor_framework.py` verifies imports;
  check the actual distributed artifact and its matching source/build inputs.

## Release gates

1. Use the reviewed public history and public author identity. The prepared history
   contains three commits with the identity explicitly selected by the maintainer.
   Pre-rewrite Git metadata,
   stashes and diagnostic artifacts are backed up outside this repository; never
   publish that private backup or mirror obsolete refs from it. Inspect outgoing
   refs again before pushing, and do not upload private symbol archives.
2. Run source, format, lint, type and test checks on the final tree. Add CI enforcement
   for incoming changes; there is currently no tracked GitHub workflow. Format
   changes in their owning patch rather than hiding files to make checks pass.
3. Run relevant native checks on fresh target-platform packages. Contract tests and
   old validation diaries do not establish present binary behavior or WAN readiness.
4. Review the exact Framework codec/build policy. Earlier validation used proprietary
   codecs/FFmpeg; notices alone do not establish redistribution rights or satisfy
   all source/relinking obligations. Verify the selected release's actual inputs.
5. Regenerate notices and inspect package contents. Keep credentials, personal paths,
   app profiles, logs and private repositories out of source and binary releases.

Run these gates again on the final publication tree rather than relying on older
validation reports. Required machine-local configuration and optional private
checkouts remain ignored; publish through Git or the source exporter, never by
archiving the complete development folder.
