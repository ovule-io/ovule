#!/usr/bin/env python3
"""Run layered Ovule source, package, and platform-native smoke checks."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from typing import NamedTuple


class Step(NamedTuple):
    name: str
    command: list[str]
    environment: dict[str, str] | None = None


ADAPTERS = {
    "runtime-capabilities": ("runtime-capabilities.mjs", []),
    "local-files-native": ("local-files-native-smoke.mjs", []),
    "core-native": ("core-native.mjs", []),
    "harness": ("harness-native.mjs", []),
    "thinking": ("thinking.mjs", []),
    "cloudflare-setup": ("cloudflare-setup.mjs", []),
    "remote-host-menu": ("remote-host-menu.mjs", []),
    "spa-package": ("spa-package.mjs", []),
    "thread-surface": ("thread-surface.mjs", []),
    "thread-stress": ("thread-surface.mjs", ["--stress"]),
    "native-cdp": ("native-cdp.mjs", []),
    "remote-control-e2e": ("remote-control-e2e.mjs", []),
    "native-ui": ("native-ui.mjs", []),
    "explorer-context-menu": ("explorer-context-menu.mjs", []),
    "explorer-inspect": ("explorer-inspect.mjs", []),
    "root-inspect": ("root-inspect.mjs", []),
    "process-exit": ("process-exit.mjs", []),
    "omnibox-native": ("omnibox-native-smoke.mjs", []),
}

WINDOWS_ONLY = {"native-cdp", "native-ui", "explorer-context-menu", "explorer-inspect", "root-inspect"}

SUITES = {
    "runtime": ["runtime-capabilities"],
    "local-files": ["local-files-native"],
    "harness": ["harness"],
    "omnibox": ["omnibox-native"],
    "connectivity": ["cloudflare-setup"],
    "thinking": ["thinking"],
    "remote-host-menu": ["remote-host-menu"],
    "package": [],
    "core": ["core-native", "thread-surface", "native-cdp", "remote-control-e2e"],
    "spa": ["spa-package", "thread-surface", "thread-stress", "native-ui", "explorer-context-menu", "explorer-inspect", "root-inspect"],
    "full": list(ADAPTERS),
}

REQUIRED_ASSET_PATHS = {
    "tuffite.js",
    "desktop/dist/resources/extensions/cloudflare-connectivity/extension.json",
    "desktop/dist/resources/extensions/cloudflare-connectivity/dist/ui.js",
    "desktop/dist/resources/extensions/agent-codex/extension.json",
    "desktop/dist/resources/extensions/agent-codex/dist/extension.mjs",
    "desktop/dist/resources/extensions/agent-deepseek/extension.json",
    "desktop/dist/resources/extensions/agent-deepseek/dist/extension.mjs",
    "desktop/dist/resources/extensions/visuals/extension.json",
    "desktop/dist/resources/extensions/visuals/dist/ui.js",
    "desktop/dist/resources/web/extensions/visuals/dist/web/pdf.worker.mjs",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-root", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path)
    parser.add_argument("--suite", choices=sorted(SUITES), default="full")
    parser.add_argument("--source-checks", action="store_true")
    parser.add_argument("--require-native", action="store_true")
    parser.add_argument("--keep-going", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_package(package_root: Path) -> str:
    manifest_path = package_root / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError(f"package manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("package manifest does not contain files")
    declared: set[str] = set()
    for record in files:
        relative = record.get("path")
        if not isinstance(relative, str) or not relative:
            raise RuntimeError("package manifest contains an invalid path")
        normalized = relative.replace("\\", "/")
        if normalized.startswith("/") or ".." in Path(normalized).parts:
            raise RuntimeError(f"unsafe package manifest path: {relative}")
        declared.add(normalized)
        file_path = package_root / Path(normalized)
        if not file_path.is_file():
            raise RuntimeError(f"declared package file is missing: {normalized}")
        if record.get("size") != file_path.stat().st_size:
            raise RuntimeError(f"package file size mismatch: {normalized}")
        if record.get("sha256") != sha256(file_path):
            raise RuntimeError(f"package file hash mismatch: {normalized}")
    app_manifest_path = package_root / "tuffite.json"
    if not app_manifest_path.is_file():
        raise RuntimeError(f"packaged application manifest is missing: {app_manifest_path}")
    app_manifest = json.loads(app_manifest_path.read_text(encoding="utf-8"))
    app = app_manifest.get("app", {})
    asset_root = app.get("assetRoot")
    if asset_root is None and manifest.get("schema_version") == 2:
        asset_root = "assets"
    if not isinstance(asset_root, str) or not asset_root:
        raise RuntimeError("packaged application manifest has no app.assetRoot")
    main_html = "desktop/dist/client/index.html"
    preview_html = "desktop/dist/client/preview.html"
    required_paths = {f"{asset_root}/{path}" for path in REQUIRED_ASSET_PATHS | {main_html, preview_html}}
    missing = sorted(required_paths - declared)
    if missing:
        raise RuntimeError(f"required package files are not declared: {', '.join(missing)}")
    extension_prefixes = (f"{asset_root}/desktop/dist/resources/extensions/", f"{asset_root}/desktop/dist/resources/web/extensions/", f"{asset_root}/desktop/dist/resources/web/plugins/")
    source_leaks = sorted(
        path
        for path in declared
        if path.startswith(extension_prefixes)
        and ("/src/" in path or path.endswith("/package.json"))
    )
    if source_leaks:
        raise RuntimeError(
            "extension package contains npm/source files: " + ", ".join(source_leaks)
        )
    assets_prefix = f"{asset_root}/{Path(main_html).parent.as_posix()}/assets/"
    route_chunks = {path for path in declared if path.startswith(assets_prefix)
                    and Path(path).name.startswith("route") and path.endswith(".js")}
    if len(route_chunks) < 3:
        raise RuntimeError("React Router main, thread, and pane route chunks are missing")
    entry_scripts = []
    for entry in (main_html, preview_html):
        html = (package_root / asset_root / entry).read_text(encoding="utf-8")
        scripts = re.findall(r'<script[^>]+src="/assets/([^"?]+\.js)"', html)
        if not scripts:
            raise RuntimeError(f"HTML entry has no bundled script: {entry}")
        linked = {assets_prefix + script for script in scripts}
        if linked - declared:
            raise RuntimeError(f"HTML entry references undeclared scripts: {entry}")
        entry_scripts.append(linked)
    if entry_scripts[0] == entry_scripts[1]:
        raise RuntimeError("app and local HTML must use distinct entry modules")
    actual = {
        path.relative_to(package_root).as_posix()
        for path in package_root.rglob("*")
        if path.is_file() and path != manifest_path
    }
    undeclared = sorted(actual - declared)
    if undeclared:
        raise RuntimeError(f"package contains undeclared files: {', '.join(undeclared)}")
    for required in (manifest.get("executable"), manifest.get("runtime_library")):
        if not isinstance(required, str) or not (package_root / required).is_file():
            raise RuntimeError(f"package runtime file is missing: {required}")
    return f"files={len(files)} manifest_sha256={sha256(manifest_path)}"


def source_steps() -> tuple[list[Step], Path]:
    isolation_root = Path(tempfile.gettempdir()) / f"ovule-source-check-{os.getpid()}"
    environment = os.environ.copy()
    environment["OVULE_EXTENSION_OUT_DIR"] = str(isolation_root / "extensions")
    environment["OVULE_UI_OUT_DIR"] = str(isolation_root / "ui")
    return [
        Step(
            "bun-check",
            ["mise", "exec", "--", "bun", "run", "--cwd", "desktop", "check"],
            environment,
        ),
        Step("rust-fmt", [sys.executable, "scripts/cargo.py", "fmt"]),
        Step("rust-check", [sys.executable, "scripts/cargo.py", "check"]),
        Step("rust-test", [sys.executable, "scripts/cargo.py", "test"]),
        Step("rust-clippy", [sys.executable, "scripts/cargo.py", "clippy"]),
    ], isolation_root


def native_steps(
    repo_root: Path,
    package_root: Path,
    suite: str,
) -> tuple[list[Step], list[str]]:
    scripts = repo_root / "desktop" / "smoke"
    system = platform.system()
    steps: list[Step] = []
    skipped: list[str] = []
    node = shutil.which("node")
    for name in SUITES[suite]:
        script_name, extra = ADAPTERS[name]
        script = scripts / script_name
        if system != "Windows" and name in WINDOWS_ONLY:
            skipped.append(f"{name}: requires Windows native desktop APIs or executable fixtures")
            continue
        if not script.is_file() or node is None:
            skipped.append(f"{name}: Node.js runner is unavailable")
            continue
        steps.append(Step(name, [node, str(script), "--package-root", str(package_root), *extra]))
    return steps, skipped


def display_command(command: list[str]) -> str:
    return subprocess.list2cmdline(command) if os.name == "nt" else " ".join(command)


def main() -> int:
    args = parse_args()
    default_root = Path(__file__).resolve().parents[4]
    repo_root = (args.repo_root or default_root).resolve()
    package_root = args.package_root.resolve()
    if not (repo_root / "Cargo.toml").is_file() or not (repo_root / "tuffite.json").is_file():
        raise SystemExit(f"not a Ovule repository root: {repo_root}")

    failures: list[str] = []
    if args.source_checks:
        steps, source_isolation_root = source_steps()
        print(f"SOURCE-ISOLATION root={source_isolation_root}", flush=True)
    else:
        steps = []
        source_isolation_root = None
    native, skipped = native_steps(repo_root, package_root, args.suite)
    for reason in skipped:
        print(f"SKIP {reason}", flush=True)
    if skipped and args.require_native:
        failures.extend(skipped)

    print(f"RUN package-integrity root={package_root}", flush=True)
    if args.dry_run:
        print("DRY-RUN package-integrity", flush=True)
    else:
        try:
            print(f"PASS package-integrity {validate_package(package_root)}", flush=True)
        except Exception as error:
            print(f"FAIL package-integrity: {error}", file=sys.stderr, flush=True)
            failures.append("package-integrity")
            if not args.keep_going:
                return 1

    for step in [*steps, *native]:
        print(f"RUN {step.name}: {display_command(step.command)}", flush=True)
        if args.dry_run:
            continue
        result = subprocess.run(
            step.command,
            cwd=repo_root,
            env=step.environment,
            check=False,
        )
        if result.returncode == 0:
            print(f"PASS {step.name}", flush=True)
            continue
        print(f"FAIL {step.name}: exit={result.returncode}", file=sys.stderr, flush=True)
        failures.append(step.name)
        if not args.keep_going:
            return result.returncode or 1

    if failures:
        print(f"smoke_ovule_app=failed failures={','.join(failures)}", file=sys.stderr)
        return 1
    if source_isolation_root is not None:
        shutil.rmtree(source_isolation_root, ignore_errors=True)
    print(
        f"smoke_ovule_app=ok suite={args.suite} platform={platform.system().lower()}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
