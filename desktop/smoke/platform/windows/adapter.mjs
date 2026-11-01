import { existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const execute = promisify(execFile);
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const compilations = new Map();
export async function compileWindows(source, output) {
  if (process.platform !== "win32")
    throw new Error("Win32/UIAutomation requires an interactive Windows desktop");
  const framework = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "Microsoft.NET/Framework64/v4.0.30319",
  );
  const compiler = join(framework, "csc.exe");
  if (!existsSync(compiler))
    throw new Error(`Windows .NET Framework C# compiler is missing: ${compiler}`);
  const references = source.endsWith("NativeProbe.cs")
    ? [
        "System.Drawing.dll",
        "System.Windows.Forms.dll",
        join(framework, "WPF/UIAutomationClient.dll"),
        join(framework, "WPF/UIAutomationTypes.dll"),
        join(framework, "WPF/WindowsBase.dll"),
      ]
    : [];
  await execute(
    compiler,
    [
      "/nologo",
      "/target:exe",
      "/platform:x64",
      `/out:${output}`,
      ...references.map((path) => `/reference:${path}`),
      source,
    ],
    { windowsHide: true, timeout: 60000 },
  );
  return output;
}
export async function windowsProbe(command, ...args) {
  if (process.platform !== "win32") throw new Error(`${command} requires Windows`);
  const source = join(sourceRoot, "NativeProbe.cs");
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex")
    .slice(0, 16);
  const cache = join(tmpdir(), `ovule-native-probe-${hash}`);
  mkdirSync(cache, { recursive: true });
  const output = join(cache, "NativeProbe.exe");
  if (!compilations.has(hash))
    compilations.set(
      hash,
      existsSync(output) ? Promise.resolve(output) : compileWindows(source, output),
    );
  await compilations.get(hash);
  return (
    await execute(output, [command, ...args.map(String)], {
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;
}
