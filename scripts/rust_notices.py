#!/usr/bin/env python3
"""Collect original license texts from the locked native dependency graph."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
OVERRIDES = ROOT / "scripts/license-overrides/rust"


def notice_text(metadata: dict) -> str:
    sections = [
        "Native application third-party notices",
        "Generated from Cargo's locked dependency graph. The list conservatively includes build/test dependencies.",
        "Third-party licenses remain in force; Ovule's MIT OR Apache-2.0 choice applies only to Ovule-owned code.",
    ]
    for package in sorted(metadata["packages"], key=lambda item: (item["name"], item["version"])):
        if package["name"].startswith("ovule") and package["source"] is None:
            continue
        root = Path(package["manifest_path"]).parent
        documents = [path for path in sorted(root.iterdir()) if path.is_file() and
                     re.match(r"(?i)^(license|licence|copying|notice|copyright)(?:[._-]|$)", path.name)]
        if package.get("license_file"):
            explicit = root / package["license_file"]
            if explicit not in documents:
                documents.append(explicit)
        if not documents and package["name"].startswith("tuffite") and package["source"] is None:
            documents = [next(parent / "LICENSE" for parent in root.parents if (parent / "LICENSE").is_file())]
        if not documents:
            supplement = OVERRIDES / f"{package['name']}-{package['version']}.txt"
            if not supplement.is_file():
                raise ValueError(f"Missing upstream license text: {package['name']}@{package['version']}; review the source package")
            documents = [supplement]
        sections.append(f"\n{'=' * 72}\n{package['name']}@{package['version']}\nDeclared license: {package.get('license')}\nSource: {package.get('repository') or package.get('source') or 'Tuffite SDK'}")
        for document in documents:
            text = document.read_text(encoding="utf-8")
            if not text.strip():
                raise ValueError(f"Empty upstream license text for {package['name']}@{package['version']}")
            sections.append(f"\n--- {document.name} ---\n{text.strip()}")
    return "\n\n".join(sections) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", type=Path, help="use a previously collected Cargo metadata JSON file")
    parser.add_argument("--output", type=Path, default=ROOT / "desktop/dist/resources/licenses/THIRD_PARTY_NOTICES.rust.txt")
    args = parser.parse_args()
    if args.metadata:
        metadata = json.loads(args.metadata.read_text())
    else:
        target = os.environ.get("CARGO_BUILD_TARGET")
        if not target:
            version = subprocess.check_output(["rustc", "--version", "--verbose"], text=True)
            target = next(line.removeprefix("host: ") for line in version.splitlines() if line.startswith("host: "))
        data = subprocess.check_output([
            sys.executable, str(ROOT / "scripts/cargo.py"), "metadata",
            "--format-version", "1", "--filter-platform", target, "--offline",
        ], text=True)
        metadata = json.loads(data)
    text = notice_text(metadata)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding="utf-8")
    print(f"rust_notices=ok packages={len(metadata['packages'])} output={args.output}")


if __name__ == "__main__":
    main()
