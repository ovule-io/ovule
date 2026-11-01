import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

export async function loadTuffiteVite() {
  const frameworkRoot = process.env.OVULE_TUFFITE_DIR;
  const loadWorkspaceSdk = (packageJson) =>
    import(pathToFileURL(createRequire(packageJson).resolve("tuffite/vite")).href);
  if (frameworkRoot)
    return loadWorkspaceSdk(resolve(frameworkRoot, "packages/tuffite/package.json"));
  try {
    return await import("tuffite/vite");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED")
      throw error;
    // Git dependencies install the workspace root, not its SDK child package.
    return loadWorkspaceSdk(import.meta.resolve("tuffite/packages/tuffite/package.json"));
  }
}
