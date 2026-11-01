#!/usr/bin/env python3
"""Run packaged Remote Control / Computer Use smoke through the Node runners."""
import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-root', type=Path, default=root / 'dist/ovule-production')
    parser.add_argument('--scope', choices=['all', 'package', 'remote-control', 'computer-use', 'e2e'], default='all')
    parser.add_argument('--keep-run-root', action='store_true')
    args = parser.parse_args()
    package = args.package_root.resolve()
    common = ['--package-root', str(package)]
    if args.scope in ('all', 'package'):
        subprocess.run([sys.executable, str(root / '.agents/skills/smoke-ovule-app/scripts/run_smoke.py'), *common, '--suite', 'package', '--require-native'], check=True)
    if args.keep_run_root:
        common.append('--keep-run-root')
    for scope in ('remote-control', 'computer-use'):
        if args.scope in ('all', scope):
            subprocess.run(['node', str(root / 'desktop/smoke/native-cdp.mjs'), *common], env={**os.environ, 'OVULE_CDP_SCOPE': scope}, check=True)
    if args.scope in ('all', 'e2e'):
        subprocess.run(['node', str(root / 'desktop/smoke/remote-control-e2e.mjs'), *common], check=True)
    print(f'crd_local_smoke=ok scope={args.scope} package_root={package}')


if __name__ == '__main__':
    main()
