import path from "node:path";
import { existsSync } from "node:fs";
/** Validate the complete public surface of a source-owning business package. */
export function validateManifest(manifest, { packageRoot, fileExists = existsSync }) {
  const findings = [];
  const report = (message) => findings.push(`${manifest.name}: ${message}`);
  const packageName = manifest.name?.split("/").at(-1);
  const exported = manifest.exports;
  if (!exported || typeof exported !== "object" || Array.isArray(exported)) {
    report("exports must explicitly declare public package entries");
    return findings;
  }
  let tokenEntries = 0;
  const providerNames = [];
  const scopes = new Set(["app", "main", "settings", "thread", "pane"]);
  for (const section of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (["@ovule/ioc-container", "ovule-desktop"].includes(dependency))
        report(`forbidden dependency ${dependency}`);
    }
  }
  for (const [name, entry] of Object.entries(exported)) {
    const declaration =
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.keys(entry).length === 1 &&
      typeof entry.types === "string" &&
      entry.types.endsWith(".d.ts");
    const token = typeof entry === "string" && entry.endsWith(".token.ts");
    const provider = typeof entry === "string" && entry.endsWith(".provider.ts");
    if (name.includes("*") || !(declaration || token || provider)) report(`illegal export ${name}`);
    if (token || provider) {
      const kind = token ? "token" : "provider";
      tokenEntries += Number(token);
      if (token && (name !== `./${packageName}.token` || entry !== `./src/${packageName}.token.ts`))
        report(`token entry must be ./${packageName}.token -> ./src/${packageName}.token.ts`);
      if (provider) {
        const basename = name.slice(2, -".provider".length);
        providerNames.push(basename);
        if (
          !name.startsWith("./") ||
          !name.endsWith(".provider") ||
          !(basename === packageName || scopes.has(basename)) ||
          entry !== `./src/${basename}.provider.ts`
        )
          report("provider entries must match a package or lifecycle scope name at src root");
      }
    }
    const target = declaration ? entry.types : entry;
    if (
      typeof target === "string" &&
      !path.resolve(packageRoot, target).startsWith(`${path.join(packageRoot, "src")}${path.sep}`)
    )
      report(`export ${name} must belong to its source directory`);
    if (typeof target !== "string" || !fileExists(path.resolve(packageRoot, target)))
      report(`missing export ${name}`);
  }
  if (tokenEntries !== 1) report("packages require exactly one public token entry");
  if (providerNames.length > 1 && providerNames.includes(packageName) && !scopes.has(packageName))
    report("packages cannot mix a package provider with scope providers");
  return findings;
}
