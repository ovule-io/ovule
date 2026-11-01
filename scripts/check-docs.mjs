#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(filename)));
    else if (entry.name.endsWith(".md")) files.push(filename);
  }
  return files;
}
const files = [
  ...(await markdownFiles(path.join(root, "docs"))),
  path.join(root, "README.md"),
  path.join(root, "CONTRIBUTING.md"),
  path.join(root, "desktop/extensions/cloudflare-connectivity/README.md"),
];
const errors = [];
for (const filename of files) {
  const source = await readFile(filename, "utf8");
  const label = path.relative(root, filename);
  if (/\p{Script=Han}/u.test(source))
    errors.push(`${label}: use English documentation`);
  // Ignore example code; validate local inline Markdown links in prose.
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  for (const match of prose.matchAll(/\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("#")) continue;
    const [relative, fragment] = target.split("#");
    const destination = path.resolve(
      path.dirname(filename),
      decodeURIComponent(relative),
    );
    if (!(await stat(destination).catch(() => null))) {
      errors.push(`${label}: missing link target ${target}`);
      continue;
    }
    if (fragment && destination.endsWith(".md")) {
      const contents = await readFile(destination, "utf8");
      const headings = [...contents.matchAll(/^#{1,6}\s+(.+)$/gm)].map(
        (heading) =>
          heading[1]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, "")
            .replace(/\s/g, "-"),
      );
      if (!headings.includes(decodeURIComponent(fragment)))
        errors.push(`${label}: missing heading ${target}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log(`docs_check=ok files=${files.length}`);
