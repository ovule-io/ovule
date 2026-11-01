#!/usr/bin/env python3
"""Import or verify a pinned Tuffite Distribution without downloading or publishing."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent.parent / "vendors" / "tuffite-framework"
TARGETS = {
    "macos-x86_64": "x86_64-apple-darwin",
    "macos-arm64": "aarch64-apple-darwin",
    "windows-x64": "x86_64-pc-windows-msvc",
}


def safe_path(root: Path, relative: str) -> Path:
    path = root / relative
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ValueError(f"unsafe distribution path: {relative}")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"distribution path escapes root: {relative}")
    return path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(root: Path, platform: str) -> dict:
    manifest = json.loads((root / "tuffite-framework.json").read_text())
    expected = {"target": TARGETS[platform], "framework_version": "0.1.0", "ffi_abi_major": 2,
                "profile": "release", "component_build": False}
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise ValueError(f"{key}: expected {value!r}, got {manifest.get(key)!r}")
    if not {"shell_api", "explorer", "remoting"}.issubset(manifest["features"]):
        raise ValueError("distribution must support shell_api, explorer and remoting")
    notices = {"licenses/LICENSE.tuffite.txt", "licenses/LICENSE.chromium.txt",
               "licenses/THIRD_PARTY_NOTICES.chromium.txt"}
    if not notices.issubset({entry["path"] for entry in manifest["runtime_files"]}):
        raise ValueError("distribution must declare Framework and Chromium license texts; repackage it")
    runtime = safe_path(root, manifest["runtime_directory"])
    entries = [(safe_path(root, manifest["bootstrap"]["path"]), manifest["bootstrap"])]
    entries += [(safe_path(runtime, entry["path"]), entry) for entry in manifest["runtime_files"]]
    for path, entry in entries:
        if not path.is_file() or path.stat().st_size != entry["size"] or sha256(path) != entry["sha256"]:
            raise ValueError(f"file size/hash mismatch: {path}")
        if path.is_relative_to(runtime) and path.relative_to(runtime).as_posix() in notices:
            if not path.read_bytes().strip():
                raise ValueError(f"empty distribution license: {path}")
    link = safe_path(root, manifest["link_directory"])
    library = "libtuffite.dylib" if platform.startswith("macos") else "tuffite.dll.lib"
    if not (link / library).is_file():
        raise ValueError(f"missing link library: {link / library}")
    # The macOS link library is the same dylib included in the runtime manifest.
    if platform.startswith("macos") and sha256(link / library) != sha256(runtime / library):
        raise ValueError("macOS link/runtime library mismatch")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=TARGETS)
    parser.add_argument("--replace", action="store_true", help="replace a verified vendor and preserve its previous contents in a temporary backup")
    parser.add_argument("--source", type=Path, help="import from an existing unpacked Distribution")
    args = parser.parse_args()
    if args.replace and args.source is None:
        parser.error("--replace requires --source")
    destination = ROOT / args.platform
    if args.source is None:
        manifest = verify(destination, args.platform)
    else:
        source = args.source.resolve()
        manifest = verify(source, args.platform)
        if (destination / "tuffite-framework.json").exists() and not args.replace:
            raise ValueError(f"{destination} already contains an artifact; review/archive it before replacing")
        ROOT.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".vendor-", dir=ROOT) as temporary:
            staged = Path(temporary) / args.platform
            shutil.copytree(source, staged, symlinks=True)
            verify(staged, args.platform)
            for path in staged.rglob("*"):
                if path.is_file(): path.chmod(path.stat().st_mode | 0o444)
            if destination.exists() and args.replace:
                backup = Path(tempfile.mkdtemp(prefix="ovule-vendor-backup-")) / args.platform
                shutil.move(str(destination), backup)
                print(f"vendor_framework_backup={backup}", flush=True)
            elif destination.exists():
                for path in staged.iterdir():
                    if (destination / path.name).exists():
                        raise ValueError(f"destination already contains {path.name}")
            if not destination.exists():
                staged.rename(destination)
            else:
                for path in staged.iterdir(): path.rename(destination / path.name)
    print(f"vendor_framework=ok platform={args.platform} version={manifest['framework_version']} abi={manifest['ffi_abi_major']}")


if __name__ == "__main__":
    main()
