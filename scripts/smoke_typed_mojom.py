#!/usr/bin/env python3
"""Validate typed Browser APIs, permissions and RAII shutdown in an isolated package."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path("dist/ovule-mojom"))
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    source = args.package.resolve()
    root = Path(tempfile.mkdtemp(prefix="ovule-typed-mojom-"))
    package = root / "application"
    print(f"typed_mojom_evidence={root}", flush=True)
    if os.name == "nt":
        subprocess.run(["icacls", str(root), "/grant", "*S-1-5-12:(OI)(CI)(RX)",
                        "*S-1-15-2-1:(OI)(CI)(M)", "*S-1-15-2-2:(OI)(CI)(M)", "/Q"], check=True)
    shutil.copytree(source, package)
    manifest_path = package / "tuffite.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    fixture = json.loads((project / "desktop/smoke/fixtures/runtime.json").read_text(encoding="utf-8"))
    manifest["app"].update(fixture["app"])
    manifest["browser"] = fixture["browser"]
    for capability in manifest["browser"]["rules"]:
        if capability["identifier"] == "app-shell":
            grants = capability["shellApi"]
            denied = "ovule.Workspace.RenameProject"
            narrowed = [grant for grant in grants if (grant if isinstance(grant, str) else grant["method"]) != denied]
            if len(narrowed) != len(grants) - 1:
                raise RuntimeError(f"expected one packaged permission for {denied}")
            scoped = {"ovule.Workspace.BrowserSuggestions", "tuffite.Dialog.OpenDirectory"}
            for method in scoped:
                matching = [grant for grant in narrowed
                            if (grant if isinstance(grant, str) else grant["method"]) == method]
                if len(matching) != 1:
                    raise RuntimeError(f"expected one packaged permission for {method}")
            narrowed = [grant for grant in narrowed
                        if (grant if isinstance(grant, str) else grant["method"]) not in scoped]
            narrowed.extend({"method": method, "allow": [{"path": "data/**"}]}
                            for method in sorted(scoped))
            # This deny must override the separate Fs.* allow grant.
            narrowed.append({"method": "tuffite.Fs.WriteFile",
                             "deny": [{"path": "data/protected.bin"}]})
            capability["shellApi"] = narrowed
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    workspace = root / "workspace"
    workspace.mkdir()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    environment = dict(os.environ, OVULE_DATA_DIR=str(root / "data"), OVULE_CDP_PORT=str(port),
                       OVULE_SMOKE_WORKSPACE=str(workspace))
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required")
    executable = package / ("ovule.exe" if os.name == "nt" else "ovule")
    for restart in (False, True):
        stage = "restart" if restart else "first"
        environment["OVULE_SMOKE_RESTART"] = "1" if restart else "0"
        with (root / f"{stage}.log").open("wb") as log:
            process = subprocess.Popen([str(executable), "--no-first-run", "--tuffite-runtime-snapshot",
                f"--remote-debugging-port={port}", f"--user-data-dir={root / 'profile'}"],
                cwd=package, env=environment, stdout=log, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            try:
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError(f"early exit: {root / (stage + '.log')}")
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as response:
                            if json.load(response).get("webSocketDebuggerUrl"):
                                break
                    except OSError:
                        pass
                    time.sleep(0.2)
                else:
                    raise RuntimeError("CDP did not start")
                subprocess.run([node, "smoke/typed-mojom-smoke.mjs"], cwd=project / "desktop",
                               env=environment, check=True, timeout=90)
                start = time.monotonic()
                code = process.wait(timeout=20)
                if code != 0:
                    raise RuntimeError(f"shutdown failed: {code}")
                print(f"typed_mojom_shutdown={stage} seconds={time.monotonic()-start:.2f}", flush=True)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
    print("typed_mojom_smoke=ok", flush=True)


if __name__ == "__main__":
    main()
