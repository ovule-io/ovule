#!/usr/bin/env python3
"""Export public working-tree files without Git history or ignored private repositories."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/ovule-public-source.tar.gz')
    parser.add_argument('--terms-file', type=Path)
    args = parser.parse_args()
    check = ['python3', str(ROOT / 'scripts/check_public_source.py')]
    if args.terms_file:
        check += ['--terms-file', str(args.terms_file.resolve())]
    subprocess.run(check, check=True, cwd=ROOT)
    candidates = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
    files = sorted({name for name in candidates if name and (ROOT / name).is_file()})
    manifest = []
    for name in files:
        path = ROOT / name
        if name.startswith(('plugins/', 'desktop/plugins/')):
            raise RuntimeError('Optional repositories cannot enter a public source export')
        if path.is_symlink():
            target = path.resolve()
            if not target.is_relative_to(ROOT) or target.is_relative_to(ROOT / 'plugins'):
                raise RuntimeError(f'Symlink escapes the public source boundary: {name}')
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        manifest.append({'path': name, 'sha256': digest, 'size': path.stat().st_size})
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + '.tmp')
    def public_metadata(info):
        info.uid = info.gid = 0
        info.uname = info.gname = ''
        return info
    with tarfile.open(temporary, 'w:gz', dereference=False) as archive:
        for name in files:
            archive.add(ROOT / name, arcname='ovule/' + name, recursive=False, filter=public_metadata)
        payload = (json.dumps({'formatVersion': 1, 'files': manifest}, indent=2) + '\n').encode()
        info = tarfile.TarInfo('ovule/SOURCE-MANIFEST.json')
        info.size = len(payload)
        info.mode = 0o644
        archive.addfile(info, io.BytesIO(payload))
    temporary.replace(output)
    with output.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(checksum + '  ' + output.name + '\n')
    print(f'public_source_export=ok files={len(files)} output={output}')


if __name__ == '__main__':
    main()
