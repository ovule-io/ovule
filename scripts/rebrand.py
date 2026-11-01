#!/usr/bin/env python3
"""Preview or apply a coordinated brand rename to Git-owned UTF-8 files and paths."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess


def source_files(root: Path) -> list[Path]:
    result = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    )
    return sorted({root / name.decode() for name in result.split(b"\0") if name
                   and (root / name.decode()).is_file()
                   and not (root / name.decode()).is_symlink()})


def replacement(old: dict[str, str], new: dict[str, str]):
    pairs = {old[key]: (new["slug"].title() if key == "displayName" else new[key])
             for key in old}
    for transform in (str.lower, str.upper, str.title):
        pairs.setdefault(transform(old["slug"]), transform(new["slug"]))
    # Match once: a destination containing the old slug must not be replaced twice.
    pattern = re.compile("|".join(re.escape(key) for key in sorted(pairs, key=len, reverse=True)))
    return lambda value: pattern.sub(lambda match: pairs[match.group()], value)


def plan(root: Path, files: list[Path], replace):
    edits = []
    moves = {}
    for path in files:
        data = path.read_bytes()
        if b"\0" not in data:
            try:
                updated = replace(data.decode("utf-8")).encode("utf-8")
            except UnicodeDecodeError:
                updated = data
            if updated != data:
                edits.append((path, updated))
        for entry in (path, *path.parents):
            if entry == root:
                break
            name = replace(entry.name)
            if name != entry.name:
                moves[entry] = entry.with_name(name)
    for source, destination in moves.items():
        if destination.exists():
            raise ValueError(f"rename destination already exists: {destination}")
    destinations = [replace(path.relative_to(root).as_posix()) for path in files]
    if len(set(destinations)) != len(destinations):
        raise ValueError("multiple source files would have the same destination")
    return edits, sorted(moves.items(), key=lambda item: len(item[0].parts), reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", help="lowercase product / package / protocol name")
    parser.add_argument("--display-name")
    parser.add_argument("--domain")
    parser.add_argument("--reverse-domain")
    parser.add_argument("--apply", action="store_true", help="write changes; default is preview")
    parser.add_argument("--check-for", help="fail if this previous brand remains in source or paths")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    files = source_files(root)
    if args.check_for:
        needle = args.check_for.lower().encode()
        found = [str(path.relative_to(root)) for path in files
                 if needle in path.relative_to(root).as_posix().lower().encode()
                 or needle in path.read_bytes().lower()]
        print("\n".join(found) if found else "Brand audit passed")
        return bool(found)
    if not args.slug and not args.display_name:
        parser.error("provide --slug or --display-name")
    if not args.slug and (args.domain or args.reverse_domain):
        parser.error("--domain and --reverse-domain require --slug")
    if args.slug and not re.fullmatch(r"[a-z][a-z0-9]*", args.slug):
        parser.error("--slug must contain only lowercase ASCII letters and digits")
    config = root / "branding.json"
    old = json.loads(config.read_text())
    new = {"slug": args.slug or old["slug"],
           "displayName": args.display_name or args.slug.title(),
           "domain": args.domain or (f"{args.slug}.io" if args.slug else old["domain"]),
           "reverseDomain": args.reverse_domain or (f"io.{args.slug}" if args.slug else old["reverseDomain"])}
    if args.slug:
        edits, moves = plan(root, files, replacement(old, new))
    else:
        edits, moves = [], []
    manifest_path = root / "tuffite.json"
    if not args.slug and manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        for window in manifest["app"]["windows"]:
            if window.get("title") == old["displayName"]:
                window["title"] = new["displayName"]
        edits.append((manifest_path, (json.dumps(manifest, indent=2) + "\n").encode()))
    edits = [(path, data) for path, data in edits if path != config]
    edits.append((config, (json.dumps(new, indent=2) + "\n").encode()))
    print(f"{'Applying' if args.apply else 'Preview'}: {len(edits)} text files, {len(moves)} path renames")
    print(json.dumps(new, indent=2))
    for source, destination in moves:
        print(f"  {source.relative_to(root)} -> {destination.relative_to(root)}")
    if args.apply:
        for path, data in edits:
            path.write_bytes(data)
        for source, destination in moves:
            source.rename(destination)
        config.write_text(json.dumps(new, indent=2) + "\n")
        if args.slug and manifest_path.is_file() and new["displayName"] != new["slug"].title():
            content = manifest_path.read_text()
            content = content.replace(f'"title": "{new["slug"].title()}"',
                                      f'"title": {json.dumps(new["displayName"])}')
            manifest_path.write_text(content)
        print("Reinstall Bun workspace links, regenerate ShellAPI, rebuild and run checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
