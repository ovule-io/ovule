#!/usr/bin/env python3
"""Launch an intact Windows package, selecting the newest package by default."""
import argparse
from pathlib import Path
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-root', type=Path)
    args, application_args = parser.parse_known_args()
    required = ('ovule.exe', 'tuffite.dll', 'ovule.dll', 'tuffite.json')
    package = args.package_root
    if package is None:
        candidates = [p for p in (root / 'dist').glob('*') if p.is_dir() and all((p / name).is_file() for name in required)]
        if not candidates:
            parser.error('No complete package found under dist; build the package first')
        package = max(candidates, key=lambda p: p.stat().st_mtime)
    package = package.resolve()
    missing = [name for name in required if not (package / name).is_file()]
    if missing:
        parser.error(f'Incomplete package at {package}: missing {", ".join(missing)}')
    subprocess.Popen([str(package / 'ovule.exe'), *application_args], cwd=package)


if __name__ == '__main__':
    main()
