#!/usr/bin/env python3
"""Remove only Ovule's generated development package."""

from __future__ import annotations

from pathlib import Path
import shutil


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    dist = (root / "dist").resolve()
    package = dist / "ovule-dev"
    if package.parent != dist or package.name != "ovule-dev":
        raise SystemExit(f"refusing unsafe development package path: {package}")
    if package.is_symlink():
        raise SystemExit(f"refusing to remove symlinked development package: {package}")
    if not package.exists():
        print(f"ovule_dev_clean=ok removed=false path={package}")
        return
    if not package.is_dir():
        raise SystemExit(f"development package is not a directory: {package}")
    try:
        shutil.rmtree(package)
    except PermissionError as error:
        raise SystemExit(
            f"cannot remove {package}; close the running Ovule development app and retry: {error}"
        ) from error
    print(f"ovule_dev_clean=ok removed=true path={package}")


if __name__ == "__main__":
    main()
