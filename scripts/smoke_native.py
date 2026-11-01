#!/usr/bin/env python3
"""Run core native smoke in a fresh profile, restart and verify SQLite persistence."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request
import http.server
import threading


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path("dist/ovule-smoke"))
    parser.add_argument("--port", type=int, default=9247)
    parser.add_argument("--shutdown-timeout", type=float, default=20, help="seconds to wait for a normal native process exit")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    package = args.package.resolve()
    package_manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    executable_name = package_manifest.get("executable")
    if not isinstance(executable_name, str) or Path(executable_name).name != executable_name or "/" in executable_name or "\\" in executable_name:
        raise ValueError("package executable must be a package-root filename")
    executable = package / executable_name
    if not executable.is_file(): raise ValueError(f"prepare the native package first: {executable}")
    run_root = Path(tempfile.mkdtemp(prefix="ovule-core-smoke-"))
    print(f"core_native_smoke_run_root={run_root}", flush=True)
    environment = os.environ.copy()
    environment.update(OVULE_DATA_DIR=str(run_root / "data"), OVULE_SMOKE_RUN_ROOT=str(run_root), OVULE_CDP_PORT=str(args.port))
    if environment.get("OVULE_LARK_WORKER_MOCK_E2E") == "1":
        environment["OVULE_LARK_WORKER_MOCK_LOG"] = str(run_root / "lark-worker.jsonl")
    node = shutil.which("node")
    if not node: raise ValueError("Node.js is required")
    environment["OVULE_TOOLCHAIN_CODEX_ACP"] = node
    def prepare_codex_fixture():
        fake_codex = run_root / "codex"
        marker = run_root / "codex-authenticated"
        class LoginPage(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/authorize":
                    self.send_response(302)
                    self.send_header("Location", "/authorized")
                    self.end_headers()
                    return
                marker.touch()
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<!doctype html><title>Smoke authorization</title><p>Signed in</p>")
            def log_message(self, *_args): pass
        login_server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), LoginPage)
        threading.Thread(target=login_server.serve_forever, daemon=True).start()
        authorization_url = f"http://127.0.0.1:{login_server.server_port}/authorize"
        fake_codex.write_text(f"#!{node}\n" + """
const fs = require('node:fs');
const readline = require('node:readline');
const marker = MARKER;
if (process.argv[2] === 'app-server') {
  readline.createInterface({input:process.stdin}).on('line', line => {
    const m = JSON.parse(line);
    if (m.method === 'initialize') console.log(JSON.stringify({id:m.id,result:{userAgent:'smoke'}}));
    if (m.method === 'account/login/start') {
      console.log(JSON.stringify({id:m.id,result:{type:'chatgpt',loginId:'smoke-login',authUrl:AUTH_URL}}));
      const timer=setInterval(()=>{if(fs.existsSync(marker)){clearInterval(timer);console.log(JSON.stringify({method:'account/login/completed',params:{loginId:'smoke-login',success:true}}));}},100);
    }
  });
} else if (process.argv[2] === 'login' && process.argv[3] === 'status') {
  process.exit(fs.existsSync(marker) ? 0 : 1);
} else { console.log('codex-smoke'); }
""".replace("MARKER", json.dumps(str(marker))).replace("AUTH_URL", json.dumps(authorization_url)))
        if os.name == "nt":
            # Chromium's native process launcher requires a PE executable.
            source = run_root / "FakeCodex.cs"
            source.write_text("""
using System;
using System.IO;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
public static class FakeCodex {
  static readonly string Marker = MARKER;
  static readonly string AuthUrl = AUTH_URL;
  static void Send(object value) { Console.WriteLine(new JavaScriptSerializer().Serialize(value)); }
  public static int Main(string[] args) {
    if(args.Length>=2 && args[0]=="login" && args[1]=="status") return File.Exists(Marker)?0:1;
    if(args.Length==0 || args[0]!="app-server") { Console.WriteLine("codex-smoke"); return 0; }
    string line;
    while((line=Console.ReadLine())!=null) {
      var message=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);
      object method;
      if(!message.TryGetValue("method",out method)) continue;
      if((string)method=="initialize") Send(new {id=message["id"],result=new {userAgent="smoke"}});
      if((string)method=="account/login/start") {
        Send(new {id=message["id"],result=new {type="chatgpt",loginId="smoke-login",authUrl=AuthUrl}});
        var thread=new Thread(()=>{
          while(!File.Exists(Marker)) Thread.Sleep(100);
          Send(new {method="account/login/completed",@params=new {loginId="smoke-login",success=true}});
        });
        thread.IsBackground=true;
        thread.Start();
      }
    }
    return 0;
  }
}
""".replace("MARKER", json.dumps(str(marker))).replace("AUTH_URL", json.dumps(authorization_url)), encoding="utf-8")
            fake_codex = run_root / "codex.exe"
            compiler = Path(os.environ.get("SystemRoot", "C:/Windows")) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
            subprocess.run([str(compiler), "/nologo", "/target:exe", "/reference:System.Web.Extensions.dll", f"/out:{fake_codex}", str(source)], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            fake_codex.chmod(0o755)
        environment["OVULE_TOOLCHAIN_CODEX"] = str(fake_codex)
        environment.setdefault("DEEPSEEK_API_KEY", "sk-isolated-onboarding-smoke-1234567890")
    prepare_codex_fixture()
    # Do not connect to another app if the requested debug port is already occupied.
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json/version", timeout=1).close()
    except OSError: pass
    else: raise ValueError(f"CDP port {args.port} is already in use")
    for restart in (False, True):
        stage = "restart" if restart else "first"
        environment["OVULE_SMOKE_RESTART"] = "1" if restart else "0"
        with (run_root / f"{stage}.log").open("wb") as log:
            process = subprocess.Popen([
                str(executable), "--lang=en-US", "--no-first-run", "--no-sandbox",
                f"--remote-debugging-port={args.port}", f"--user-data-dir={run_root / 'profile'}",
                f"--log-file={run_root / 'native.log'}",
            ], cwd=package, env=environment, stdout=log, stderr=subprocess.STDOUT)
            print(f"core_native_smoke_pid={process.pid} stage={stage}", flush=True)
            try:
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    if process.poll() is not None: raise RuntimeError(f"native app exited early; see {run_root / f'{stage}.log'}")
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json/version", timeout=1) as response:
                            if json.load(response).get("webSocketDebuggerUrl"): break
                    except OSError: pass
                    time.sleep(0.2)
                else: raise RuntimeError(f"CDP endpoint did not start; see {run_root}")
                subprocess.run([node, "smoke/core-native-smoke.mjs"], cwd=project / "desktop", env=environment, timeout=120, check=True)
                shutdown_started = time.monotonic()
                code = process.wait(timeout=args.shutdown_timeout)
                print(f"core_native_smoke_exit=normal stage={stage} seconds={time.monotonic() - shutdown_started:.2f}", flush=True)
                if code != 0: raise RuntimeError(f"native shutdown failed with {code}; see {run_root}")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
    print(f"core_native_smoke=ok evidence={run_root}")


if __name__ == "__main__":
    main()
