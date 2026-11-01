#!/usr/bin/env python3
"""Check public working-tree sources without reading ignored optional repositories."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]

# Deliberately narrow signatures: never print the matched credential itself.
SECRET_PATTERN = re.compile(
    r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----'
    r'|\bgh[pousr]_[A-Za-z0-9]{36,}\b'
    r'|\bgithub_pat_[A-Za-z0-9_]{82,}\b'
    r'|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'
)
PERSONAL_PATH_PATTERN = re.compile(
    r'/Users/(?!Shared/|example/|username/|user/|test/)[A-Za-z0-9_.-]+/'
    r'|[C-Z]:\\Users\\(?!Public\\|Default\\|example\\|username\\|user\\|test\\)[A-Za-z0-9_.-]+\\'
)


def source_violation(root: Path, relative: str, pattern=None):
    """Validate the boundary before reading any file, including symlink targets."""
    path = root / relative
    parts = Path(relative).parts
    if relative.startswith(('plugins/', 'desktop/plugins/')):
        return 'optional repository'
    if path.is_symlink():
        target = path.resolve()
        if not target.is_relative_to(root.resolve()):
            return 'symlink outside repository'
        target_relative = target.relative_to(root.resolve()).as_posix()
        if target_relative.startswith(('plugins/', 'desktop/plugins/')):
            return 'symlink into optional repository'
        # Only direct public files can be exported; symlinks could otherwise
        # expose ignored credentials or caches through an innocuous filename.
        return 'symlink requires explicit publication review'
    if not path.is_file():
        return None  # Pending deletions are not part of a working-tree export.
    if any(part in {'.git', '.aws', '.ssh', 'node_modules', '__pycache__'} for part in parts):
        return 'private metadata or cache'
    name = path.name.lower()
    env_example = name.endswith('.example') and (name == '.env.example' or name.startswith('.env.'))
    if (name == '.env' or name.startswith('.env.')) and not env_example:
        return 'environment credentials'
    if name in {'mise.local.toml', '.tuffite-debug.json', '.ds_store'} or path.suffix.lower() in {'.pem', '.p12', '.pfx', '.key', '.har', '.log'}:
        return 'local configuration, credentials or capture'
    if pattern and pattern.search(relative):
        return 'private term in path'
    with path.open('rb') as stream:
        if b'\0' in stream.read(4096):
            return None
    try:
        source = path.read_text(encoding='utf-8')
    except UnicodeError:
        return None  # Binary artifacts require a separate publication audit.
    if path.suffix == '.json':
        try:
            source += json.dumps(json.loads(source), ensure_ascii=False)
        except json.JSONDecodeError:
            pass
    if SECRET_PATTERN.search(source):
        return 'credential signature'
    if PERSONAL_PATH_PATTERN.search(source):
        return 'machine-specific user path'
    if pattern and pattern.search(source):
        return 'private term in content'
    return None


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
        reason = source_violation(ROOT, relative, pattern)
        if reason:
            failures.add(f'{relative} ({reason})')
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
