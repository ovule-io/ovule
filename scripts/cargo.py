#!/usr/bin/env python3
"""Run Cargo without inheriting configuration from a containing repository."""

from __future__ import annotations

import argparse
import hashlib
import os
import platform
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import tomllib


def tuffite_cli_fingerprint(framework: Path) -> str:
    digest = hashlib.sha256()
    roots = [
        framework / "Cargo.toml",
        framework / "Cargo.lock",
        framework / "rust-toolchain.toml",
        framework / "crates" / "tuffite",
        framework / "crates" / "tuffite-abi",
        framework / "crates" / "tuffite-macros",
        framework / "crates" / "tuffite-runtime",
        framework / "crates" / "tuffite-mojom",
        framework / "crates" / "tuffite-ioc",
    ]
    files: list[Path] = []
    for root in roots:
        if root.is_file():
            files.append(root)
        elif root.is_dir():
            files.extend(
                path
                for path in root.rglob("*")
                if path.is_file() and path.suffix in {".rs", ".toml", ".mjs", ".ts", ".in"}
            )
    for path in sorted(files):
        digest.update(path.relative_to(framework).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    for name in ("RUSTFLAGS", "CARGO_BUILD_TARGET", "RUSTC_WRAPPER"):
        digest.update(f"{name}={os.environ.get(name, '')}\0".encode())
    rustc = subprocess.run(
        ["rustc", "--version", "--verbose"],
        check=True,
        capture_output=True,
        text=True,
    )
    digest.update(rustc.stdout.encode())
    return digest.hexdigest()


def vendor_environment(app_root: Path) -> dict[str, str]:
    environment = os.environ.copy()
    if environment.get("OVULE_TUFFITE_DIR"):
        environment["TUFFITE_FRAMEWORK_DIR"] = str(Path(environment["OVULE_TUFFITE_DIR"]).resolve())
    environment.setdefault("CARGO_TARGET_DIR", str(app_root / "target"))
    if environment.get("TUFFITE_FRAMEWORK_DIST"):
        return environment
    target = environment.get("TUFFITE_FRAMEWORK_DIST_TARGET") or environment.get("CARGO_BUILD_TARGET")
    targets = {"x86_64-apple-darwin": "macos-x86_64", "aarch64-apple-darwin": "macos-arm64", "x86_64-pc-windows-msvc": "windows-x64"}
    if target:
        candidates = [targets[target]] if target in targets else []
    elif platform.system() == "Darwin":
        candidates = ["macos-arm64", "macos-x86_64"] if platform.machine() == "arm64" else ["macos-x86_64"]
    elif platform.system() == "Windows":
        candidates = ["windows-x64"]
    else:
        candidates = []
    for candidate in candidates:
        local = Path(environment.get("TUFFITE_FRAMEWORK_DIR", app_root.parent / "src/tuffite")) / "dist" / f"tuffite-framework-{candidate.replace('x86_64', 'x64')}"
        if (local / "tuffite-framework.json").is_file():
            return environment
        vendor = app_root / "vendors" / "tuffite-framework" / candidate
        if (vendor / "tuffite-framework.json").is_file():
            environment["TUFFITE_FRAMEWORK_DIST"] = str(vendor)
            break
    return environment


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-lock", action="store_true", help="Allow Cargo.lock updates after dependency changes")
    parser.add_argument(
        "action", choices=("fmt", "check", "test", "clippy", "build", "run", "metadata", "tuff")
    )
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    app_root = Path(__file__).resolve().parent.parent
    framework = Path(os.environ.get("OVULE_TUFFITE_DIR") or os.environ.get("TUFFITE_FRAMEWORK_DIR", app_root.parent / "src/tuffite")).resolve()
    if args.action == "tuff" and not (framework / "crates/tuffite/Cargo.toml").is_file():
        parser.error(f"Tuffite SDK checkout is missing at {framework}; set TUFFITE_FRAMEWORK_DIR")
    # Keep unit-test data isolated; Cargo reads SDK overrides from the
    # application's .cargo/config.toml and needs no implicit SDK patch.
    working_dir = Path(tempfile.gettempdir()) / (
        f"ovule-cargo-{os.getpid()}-{secrets.token_hex(4)}"
    )
    working_dir.mkdir(parents=True)
    try:
        if args.action == "tuff":
            target = Path(os.environ.get("TUFFITE_CLI_TARGET_DIR", app_root / "target/tuffite-cli")).resolve()
            build_environment = vendor_environment(app_root)
            build_environment["CARGO_TARGET_DIR"] = str(target)
            executable = target / "release" / (
                "tuff.exe" if os.name == "nt" else "tuff"
            )
            fingerprint = tuffite_cli_fingerprint(framework)
            fingerprint_path = target / "ovule-tuffite-cli.sha256"
            cached_fingerprint = (
                fingerprint_path.read_text(encoding="ascii").strip()
                if fingerprint_path.is_file()
                else ""
            )
            if not executable.is_file() or cached_fingerprint != fingerprint:
                build = subprocess.run(
                    [
                        "cargo",
                        "build",
                        "--locked",
                        "--manifest-path",
                        str(framework / "crates" / "tuffite" / "Cargo.toml"),
                        "--features",
                        "cli",
                        "--bin",
                        "tuff",
                        "--release",
                    ],
                    cwd=framework,
                    env=build_environment,
                    check=False,
                )
                if build.returncode:
                    return build.returncode
                fingerprint_path.write_text(fingerprint + "\n", encoding="ascii")
            cli_environment = vendor_environment(app_root)
            cli_environment.setdefault("TUFFITE_FRAMEWORK_DIR", str(framework))
            cli_command = [str(executable), *args.arguments]
            if cli_environment.get("OVULE_TUFFITE_DIR"):
                cli_command = ["bun", str(app_root / "scripts/local-sdk.mjs"), "--", *cli_command]
            return subprocess.run(
                cli_command,
                cwd=app_root,
                env=cli_environment,
                check=False,
            ).returncode

        command = [
            "cargo",
            *([] if args.update_lock else ["--locked"]),
            args.action,
            "--manifest-path",
            str(app_root / "Cargo.toml"),
        ]
        if args.action == "check":
            command.extend(("--workspace", "--no-default-features", "--features", "ssh_transport"))
        if args.action == "fmt":
            # A system Cargo/rustfmt can precede Mise's shims on PATH. Use the
            # repository toolchain for both checking and applying formatting.
            toolchain = tomllib.loads((app_root / "rust-toolchain.toml").read_text())["toolchain"]["channel"]
            command = ["rustup", "run", toolchain, *command]
            write = "--write" in args.arguments
            args.arguments = [arg for arg in args.arguments if arg != "--write"]
            command.extend(("--all", "--"))
            if not write:
                command.append("--check")
        elif args.action == "test":
            command.extend(("--workspace", "--no-default-features", "--features", "ssh_transport"))
        elif args.action == "clippy":
            command.extend(
                (
                    "--workspace",
                    "--all-targets",
                    "--no-default-features",
                    "--features",
                    "ssh_transport",
                    "--",
                    "-D",
                    "warnings",
                )
            )
        elif args.action == "build":
            command.append("--release")
        if any(arg in ("-p", "--package") or arg.startswith("--package=") for arg in args.arguments):
            command = [arg for arg in command if arg != "--workspace"]
            if "ovule-hosts" not in args.arguments and "ovule" not in args.arguments and "--features" in command:
                index = command.index("--features")
                del command[index:index + 2]
        if args.action == "clippy":
            command[command.index("--"):command.index("--")] = args.arguments
        else:
            command.extend(args.arguments)
        command_environment = vendor_environment(app_root)
        if args.action == "test":
            # Unit tests must not discover Extensions from the developer's real
            # Ovule profile; reconciliation tests need an empty installed root.
            command_environment["OVULE_DATA_DIR"] = str(working_dir / "data")
        if command_environment.get("OVULE_TUFFITE_DIR"):
            command = ["bun", str(app_root / "scripts/local-sdk.mjs"), "--", *[arg for arg in command if arg != "--locked"]]
        return subprocess.run(
            command,
            cwd=app_root,
            env=command_environment,
            check=False,
        ).returncode
    finally:
        shutil.rmtree(working_dir)


if __name__ == "__main__":
    sys.exit(main())
