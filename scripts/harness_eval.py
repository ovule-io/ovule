#!/usr/bin/env python3
"""Repeat real harness contracts/native adapters; retain comparable JSON evidence.

Deterministic contracts measure mechanics, never a model's task-solving quality.
External model graders may implement the same result schema with --adapter JSON.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def aggregate(trials):
    cases = {}
    for trial in trials:
        for case in trial["cases"]:
            cases.setdefault(case["id"], []).append(case)
    result = []
    for case_id, values in sorted(cases.items()):
        passed = sum(v["status"] == "pass" for v in values)
        failed = sum(v["status"] == "fail" for v in values)
        skipped = len(values) - passed - failed
        latencies = sorted(v["duration_ms"] for v in values if v["status"] != "skip")
        result.append({"id": case_id, "trials": len(values), "passed": passed,
                       "failed": failed, "skipped": skipped,
                       "success_at_k": passed > 0,
                       "all_of_k": passed == len(values),
                       "p50_ms": latencies[math.ceil(len(latencies)*.5)-1] if latencies else None,
                       "p95_ms": latencies[math.ceil(len(latencies)*.95)-1] if latencies else None})
    return result


def regressions(current, baseline):
    previous = {case["id"]: case for case in baseline}
    return [case["id"] for case in current if case["id"] in previous
            and previous[case["id"]]["all_of_k"] and not case["all_of_k"]]


def run_adapter(command, destination, timeout, expected_ids):
    started = time.monotonic()
    env = {**os.environ, "OVULE_EVAL_OUTPUT": str(destination)}
    try:
        with destination.with_suffix(".log").open("w") as log:
            run = subprocess.run(command, cwd=ROOT, env=env, stdout=log,
                                 stderr=subprocess.STDOUT, timeout=timeout, check=False)
        report = json.loads(destination.read_text()) if destination.exists() else {"cases": []}
        if report.get("schema_version") != 1:
            raise ValueError("adapter report requires schema_version=1")
        actual = report.get("cases", [])
        ids = [case.get("id") for case in actual]
        if len(ids) != len(set(ids)) or set(ids) != set(expected_ids):
            raise ValueError("adapter case IDs must exactly match its versioned dataset")
        for case in actual:
            if case.get("status") not in {"pass", "fail", "skip"}:
                raise ValueError("invalid adapter status")
            duration = case.get("duration_ms")
            if not isinstance(duration, (float, int)) or isinstance(duration, bool) or not math.isfinite(duration) or duration < 0:
                raise ValueError("invalid adapter duration")
        if run.returncode and not any(case["status"] == "fail" for case in actual):
            raise ValueError(f"adapter exited {run.returncode} despite passing report")
        return report
    except (subprocess.TimeoutExpired, OSError, ValueError, TypeError, KeyError) as error:
        return {"cases": [{"id": key, "status": "fail",
                           "duration_ms": (time.monotonic()-started)*1000,
                           "reason": str(error)[:1024]} for key in expected_ids]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["contract", "native"], default="contract")
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--package-root", type=Path)
    parser.add_argument("--browser-placement", choices=["overlay", "sidebar", "workbench", "window"], default="overlay")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--adapter", type=Path, help="JSON with argv, case_ids, kind=model|deterministic")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.repeat <= 100 or args.timeout < 1:
        parser.error("repeat must be 1..100 and timeout positive")
    dataset_path = ROOT / "evals/harness/cases.json"
    dataset = json.loads(dataset_path.read_text())
    adapter_hash = hashlib.sha256(args.adapter.read_bytes()).hexdigest() if args.adapter else None
    kind = "deterministic"
    parameters = {"browser_placement": args.browser_placement} if args.suite == "native" else {}
    if args.adapter:
        adapter = json.loads(args.adapter.read_text())
        command, expected, kind = adapter["argv"], adapter["case_ids"], adapter["kind"]
        if kind not in {"model", "deterministic"} or not isinstance(command, list) or not all(isinstance(v,str) for v in command):
            parser.error("invalid adapter")
    else:
        expected = [case["id"] for case in dataset["cases"] if case["suite"] == args.suite]
        if args.suite == "contract":
            command = [sys.executable, "scripts/cargo.py", "run", "-p", "ovule", "--no-default-features", "--example", "harness_evaluate", "--offline"]
        else:
            if args.package_root is None:
                parser.error("native suite requires --package-root pointing to a fresh candidate")
            command = ["node", "desktop/smoke/harness-native.mjs", "--package-root", str(args.package_root.resolve()), "--keep-run-root", "--browser-placement", args.browser_placement]
    if not expected or len(expected) != len(set(expected)) or not all(isinstance(value,str) and value for value in expected):
        parser.error("adapter requires unique nonempty case IDs")
    output = (args.output or ROOT / "artifacts/harness-eval" / (time.strftime("%Y%m%d-%H%M%S")+"-"+uuid.uuid4().hex[:6])).resolve()
    output.mkdir(parents=True, exist_ok=False)
    trials = [run_adapter(command, output / f"trial-{index+1}.json", args.timeout, expected) for index in range(args.repeat)]
    summary = aggregate(trials)
    baseline = json.loads(args.baseline.read_text()) if args.baseline else None
    if baseline and (baseline.get("dataset_sha256") != hashlib.sha256(dataset_path.read_bytes()).hexdigest() or baseline.get("kind") != kind or baseline.get("adapter_sha256") != adapter_hash or baseline.get("suite") != args.suite or baseline.get("parameters", {}) != parameters):
        parser.error("baseline dataset/kind differs; regenerate an intentional baseline")
    regression = regressions(summary, baseline["summary"]) if baseline else []
    git = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True)
    status = subprocess.run(["git", "diff", "HEAD", "--binary"], cwd=ROOT, capture_output=True)
    source = hashlib.sha256(status.stdout)
    # Untracked implementation must contribute to evidence fingerprints too.
    untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=ROOT, capture_output=True)
    for name in sorted(untracked.stdout.split(b"\0")):
        if name and not name.startswith(b"artifacts/"):
            path = ROOT / os.fsdecode(name)
            if path.is_file():
                source.update(name); source.update(path.read_bytes())
    report = {"schema_version": 1, "dataset_version": dataset["version"],
              "dataset_sha256": hashlib.sha256(dataset_path.read_bytes()).hexdigest(),
              "adapter_sha256": adapter_hash, "git_revision": git.stdout.strip(), "working_diff_sha256": source.hexdigest(),
              "platform": platform.platform(), "kind": kind, "suite": args.suite, "parameters": parameters,
              "package_root": str(args.package_root) if args.package_root else None,
              "package_manifest_sha256": hashlib.sha256((args.package_root / "manifest.json").read_bytes()).hexdigest() if args.package_root and (args.package_root / "manifest.json").is_file() else None,
              "command": command, "summary": summary, "regressions": regression, "trials": trials}
    (output / "report.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps({"report": str(output / "report.json"), "summary": summary, "regressions": regression}, indent=2))
    return int(bool(regression) or any(case["failed"] or case["skipped"] for case in summary))


if __name__ == "__main__":
    sys.exit(main())
