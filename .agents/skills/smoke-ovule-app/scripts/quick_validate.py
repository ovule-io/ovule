#!/usr/bin/env python3
"""Fast, side-effect-free validation for the Ovule smoke skill."""

from __future__ import annotations

import argparse
import ast
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "skill_root",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="path to the smoke-ovule-app skill",
    )
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL {message}")


def read_required(path: Path) -> str:
    require(path.is_file(), f"missing required file: {path}")
    return path.read_text(encoding="utf-8")


def main() -> int:
    skill_root = parse_args().skill_root.resolve()
    skill = read_required(skill_root / "SKILL.md")
    matrix = read_required(skill_root / "references" / "smoke-matrix.md")
    runner_path = skill_root / "scripts" / "run_smoke.py"
    runner = read_required(runner_path)

    require(skill.startswith("---\n"), "SKILL.md must start with YAML frontmatter")
    require("\nname: smoke-ovule-app\n" in skill, "unexpected skill name")
    require("\ndescription:" in skill, "skill description is required")

    ast.parse(runner, filename=str(runner_path))
    for option in ("--package-root", "--suite", "--source-checks", "--require-native", "--dry-run"):
        require(option in runner, f"runner is missing {option}")

    for suite in ("core", "full", "package", "spa", "harness"):
        require(f'"{suite}"' in runner, f"runner is missing the {suite} suite")

    require("harness-native.mjs" in runner, "native Harness adapter is absent")
    require((skill_root.parents[2] / "evals/harness/cases.json").is_file(), "versioned Harness cases are absent")

    active_contract = "\n".join((skill, runner)).lower()
    require("trycua" not in active_contract, "runner or execution guidance still depends on TryCua")
    require("retired trycua" in matrix.lower(), "legacy TryCua cleanup coverage is undocumented")
    combined = "\n".join((skill, matrix, runner)).lower()
    require("native crd computer use" in combined, "native CRD Computer Use coverage is undocumented")
    require("capability registry" in matrix.lower(), "Capability Registry coverage is absent from the matrix")

    print(f"PASS smoke skill validation: {skill_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
