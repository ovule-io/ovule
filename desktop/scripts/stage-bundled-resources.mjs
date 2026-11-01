import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageBundledResources } from "./bundled-resources-plugin.mjs";

// Native development packaging runs before Vite starts and needs the same resource tree.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = await stageBundledResources(root, path.join(root, "dist/resources"));
console.log(
  `Staged ${files.length} bundled resources (${files.filter((file) => file.browser).length} browser files).`,
);
