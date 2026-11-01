#!/usr/bin/env python3
"""Archive application state after Ovule has stopped; user workspaces remain untouched."""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import uuid


def data_directory(release: bool = False) -> Path:
    if value := os.environ.get("OVULE_DATA_DIR"):
        return Path(value).expanduser().resolve()
    name = "Ovule" if release else "Ovule Debug"
    if sys.platform == "darwin":
        return Path.home() / ("Library/Application Support/io.Ovule." + name.replace(" ", "-"))
    if os.name == "nt":
        return Path(os.environ["LOCALAPPDATA"]) / "Ovule" / name / "data"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / ("ovule" if release else "ovuledebug")


def ensure_stopped(release: bool = False) -> None:
    if os.name == "nt":
        output = subprocess.check_output(["tasklist", "/FO", "CSV", "/NH"], text=True)
        names = [row[0].lower() for row in csv.reader(output.splitlines()) if row]
    else:
        output = subprocess.check_output(["ps", "-axo", "comm="], text=True)
        names = [Path(line.strip()).name.lower() for line in output.splitlines()]
    executable = "ovule" if release else "ovule-debug"
    if any(name in {executable, f"{executable}.exe"} for name in names):
        raise RuntimeError("Close Ovule before resetting its local data.")


def reset(root: Path, dry_run: bool = False) -> Path | None:
    # An allowlist prevents a supplied data directory from deleting arbitrary files.
    owned = [root / name for name in ("workspace.sqlite3", "workspace.sqlite3-wal", "workspace.sqlite3-shm")]
    owned.append(root / "secrets/workspace-link-access.json")
    selected = [path for path in owned if path.exists()]
    if any(path.is_symlink() or not path.is_file() for path in selected):
        raise RuntimeError("Refusing to reset non-regular application state files.")
    if not selected:
        print(f"No local state to reset: {root}")
        return None
    if dry_run:
        for path in selected:
            print(f"Would archive: {path}")
        return None
    connection = None
    database = root / "workspace.sqlite3"
    if database.exists():
        # Keep the write lock until all state files have moved. No migration runs here.
        connection = sqlite3.connect(f"{database.as_uri()}?mode=rw", uri=True, timeout=0)
        connection.execute("BEGIN EXCLUSIVE")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = root / "state-backups" / f"{stamp}-{uuid.uuid4().hex[:8]}"
    backup.mkdir(parents=True, mode=0o700)
    moved: list[tuple[Path, Path]] = []
    try:
        for path in selected:
            target = backup / path.relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.move(str(path), str(target))
            moved.append((path, target))
    except BaseException:
        for path, target in reversed(moved):
            shutil.move(str(target), str(path))
        raise
    finally:
        if connection:
            connection.close()
    print(f"Local state reset. Backup: {backup}")
    print("Restart Ovule and pair Link devices again. Workspaces, Toolchains, extensions and saved credentials were preserved.")
    return backup


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--release", action="store_true", help="Target production data instead of debug data")
    args = parser.parse_args()
    try:
        ensure_stopped(args.release)
        reset((args.data_dir or data_directory(args.release)).expanduser().resolve(), args.dry_run)
        return 0
    except (RuntimeError, OSError, sqlite3.Error) as error:
        print(f"Reset failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
