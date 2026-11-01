import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const projectLicense = path.resolve(scriptsRoot, "../LICENSE");
const supplements = {
  "saxes@5.0.1": "saxes-5.0.1.txt",
  "core-js@3.45.0": "core-js-3.45.0.txt",
  "react-remove-scroll-bar@2.3.8": "react-remove-scroll-bar-2.3.8.txt",
  "remark-math@6.0.0": "remark-math-6.0.0.txt",
};

/** Collect exact npm inputs, including root notices and licenses embedded in README files. */
export async function collectNotices(metafile, packages = new Map()) {
  const meta = typeof metafile === "string" ? JSON.parse(metafile) : metafile;
  if (!meta?.inputs) throw new Error("The bundler did not return its input manifest");
  for (const input of Object.keys(meta.inputs)) {
    if (!input.includes("node_modules") || input.startsWith("\0")) continue;
    const file = await realpath(path.resolve(input.split("?")[0]));
    const parts = file.split(path.sep);
    const index = parts.lastIndexOf("node_modules");
    if (index < 0) continue;
    const count = parts[index + 1].startsWith("@") ? 2 : 1;
    const root = parts.slice(0, index + count + 1).join(path.sep);
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    if (pkg.name.startsWith("@ovule/") || pkg.name.startsWith("@ovule-contrib/")) continue;
    const key = `${pkg.name}@${pkg.version}`;
    if (packages.has(key)) {
      await embeddedNotices(file, root, packages.get(key));
      continue;
    }
    const documents = [];
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        !entry.isFile() ||
        !/^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)(?:[._-]|$)/i.test(entry.name)
      )
        continue;
      documents.push({
        name: entry.name,
        text: await readFile(path.join(root, entry.name), "utf8"),
      });
    }
    if (!documents.length && supplements[key]) {
      documents.push({
        name: supplements[key],
        text: await readFile(path.join(scriptsRoot, "license-overrides", supplements[key]), "utf8"),
      });
    }
    if (!documents.length) {
      for (const entry of await readdir(root)) {
        if (!/^readme(?:[._-]|$)/i.test(entry)) continue;
        const text = await readFile(path.join(root, entry), "utf8");
        const section = text.search(/(?:^|\n)(?:#+\s*)?(?:license|licence)\s*\n/i);
        if (
          section >= 0 &&
          /Permission (?:is hereby granted|to use, copy)/i.test(text.slice(section))
        ) {
          documents.push({ name: `${entry} (license section)`, text: text.slice(section).trim() });
        }
      }
    }
    if (!documents.length) throw new Error(`Missing license text for bundled dependency ${key}`);
    packages.set(key, { license: pkg.license ?? "See upstream text", documents });
    await embeddedNotices(file, root, packages.get(key));
    // PDF.js ships its own prebuilt core-js bundle, invisible to the outer input graph.
    if (pkg.name === "pdfjs-dist") {
      const source = await readFile(file, "utf8");
      const version = source.match(/core-js\/blob\/v([\d.]+)\/LICENSE/)?.[1];
      if (!version || !supplements[`core-js@${version}`])
        throw new Error("Review the embedded PDF.js core-js license after upgrading PDF.js");
      packages.set(`core-js@${version}`, {
        license: "MIT",
        documents: [
          {
            name: "LICENSE (embedded by PDF.js)",
            text: await readFile(
              path.join(scriptsRoot, "license-overrides", supplements[`core-js@${version}`]),
              "utf8",
            ),
          },
        ],
      });
    }
  }
  return packages;
}

async function embeddedNotices(file, root, info) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const text = match[0];
    if (!/copyright|\blicen[cs]e\b|permission (?:is hereby granted|to use, copy)/i.test(text))
      continue;
    if (info.documents.some((document) => document.text.includes(text))) continue;
    info.documents.push({
      name: `Embedded notice in ${path.relative(root, file).split(path.sep).join("/")}`,
      text,
    });
  }
}

export async function writeNotices(packageRoot, packages, license = projectLicense) {
  await mkdir(packageRoot, { recursive: true });
  await copyFile(license, path.join(packageRoot, "LICENSE"));
  const sections = [
    "Third-party notices",
    "Generated from the bundled input graph. Third-party code retains its upstream license.",
    "This file contains original license and notice texts; Ovule's dual license applies only to Ovule-owned code.",
  ];
  for (const [key, info] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    sections.push(`\n${"=".repeat(72)}\n${key}\nDeclared license: ${info.license}`);
    for (const document of info.documents)
      sections.push(`\n--- ${document.name} ---\n${document.text.trim()}`);
  }
  await writeFile(path.join(packageRoot, "THIRD_PARTY_NOTICES.txt"), `${sections.join("\n\n")}\n`);
}
