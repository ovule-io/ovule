#!/usr/bin/env python3
"""Check public working-tree sources without reading ignored optional repositories."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--terms-file', type=Path, help='Private, untracked JSON list of prohibited terms')
    args = parser.parse_args()
    terms = json.loads(args.terms_file.read_text()) if args.terms_file else []
    if not isinstance(terms, list) or any(not isinstance(term, str) or not term for term in terms):
        parser.error('terms file must contain a list of nonempty strings')
    pattern = re.compile(r'(?<![a-z])(?:' + '|'.join(re.escape(term) for term in terms) + ')', re.I) if terms else None
    paths = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
    failures = set()
    for relative in paths:
        if not relative:
            continue
        path = ROOT / relative
        if not path.is_file():  # Pending deletions are not part of a working-tree export.
            continue
        if relative.startswith(('plugins/', 'desktop/plugins/')):
            failures.add(relative)
            continue
        if pattern and pattern.search(relative):
            failures.add(relative)
        if b"\0" in path.open("rb").read(4096):
            continue
        try:
            source = path.read_text()
        except UnicodeError:
            continue  # Third-party binaries are audited separately with their original licenses.
        # Check decoded JSON as well, so escaped Unicode does not bypass a private-term policy.
        if path.suffix == '.json':
            try:
                source += json.dumps(json.loads(source), ensure_ascii=False)
            except json.JSONDecodeError:
                pass
        if pattern and pattern.search(source):
            failures.add(relative)
    package = json.loads((ROOT / 'desktop/package.json').read_text())
    if any('plugins' in workspace for workspace in package['workspaces']):
        failures.add('desktop/package.json (optional repo workspace)')
    staging = (ROOT / 'desktop/scripts/bundled-resources-plugin.mjs').read_text()
    if not re.search(r'const packageDirectories\s*=\s*\["extensions"\]', staging):
        failures.add('desktop/scripts/bundled-resources-plugin.mjs (optional repo packaging)')
    if failures:
        for failure in sorted(failures):
            print(f'public_source_violation={failure}')  # Never print matching confidential text.
        raise SystemExit(1)
    print(f'public_source_check=ok files={len(set(paths)) - 1} private_terms={len(terms)}')


if __name__ == '__main__':
    main()
