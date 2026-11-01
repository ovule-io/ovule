import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { collectNotices, writeNotices } from "./third-party-notices.mjs";

const packageDirectories = ["extensions"];
const packageResources = new Set(["dist", "skills", "workflows", "assets"]);
const resourceDirectories = ["skills", "toolchains"];

/**
 * Keep runtime files outside the module graph; host programs retain their file modes.
 * Distribution preserves this directory at assets/desktop/dist/resources.
 * Native services use that disk root; only resources/web/extensions has an app.assets mount.
 * Packaged plugins remain available for explicit installation, not automatic activation.
 */
export function bundledResources({ root } = {}) {
  let desktopRoot = root;
  let clientOutput;
  let serverBuild = false;
  let notices = new Map();
  return {
    name: "ovule-bundled-resources",
    configResolved(config) {
      desktopRoot = path.resolve(desktopRoot ?? config.root);
      clientOutput = path.resolve(
        config.root,
        config.environments?.client?.build?.outDir ?? config.build.outDir,
      );
      serverBuild = Boolean(config.build.ssr);
    },
    async configureServer(server) {
      const base = path.resolve(desktopRoot ?? server.config.root);
      await stageBundledResources(base, path.join(base, "dist/resources"));
      server.middlewares.use(async (request, response, next) => {
        try {
          const file = await browserResourceForRequest(base, request.url);
          if (!file) return next();
          response.setHeader("Content-Type", contentType(file));
          createReadStream(file).on("error", next).pipe(response);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      if (this.environment?.name && this.environment.name !== "client") return;
      if (!this.environment && serverBuild) return;
      // Include extracted CSS/font inputs as well as JavaScript chunks.
      const inputs = Object.fromEntries([...this.getModuleIds()].map((id) => [id, {}]));
      notices = await collectNotices({ inputs });
    },
    async writeBundle(outputOptions) {
      // React Router builds client/SSR environments from one top-level config.
      // Output hook options are the directory Vite actually wrote, including custom build roots.
      if (this.environment?.name && this.environment.name !== "client") return;
      if (!this.environment && serverBuild) return;
      const output = path.resolve(desktopRoot, outputOptions.dir ?? clientOutput);
      await stageBundledResources(desktopRoot, path.join(path.dirname(output), "resources"));
      await writeNotices(path.join(path.dirname(output), "resources/licenses"), notices);
    },
  };
}

/** Copy only distributable package files, preserving package-relative host/skill paths. */
export async function stageBundledResources(desktopRoot, outputRoot) {
  const files = await bundledResourceFiles(desktopRoot);
  await rm(outputRoot, { recursive: true, force: true });
  // The manifest mounts this directory even when no extension contributes browser files.
  await mkdir(path.join(outputRoot, "web/extensions"), { recursive: true });
  for (const file of files) {
    await copyResource(file.source, path.join(outputRoot, file.relative));
    // The browser mount has no host executables, Node workers, manifests, or skills.
    if (file.browser) {
      await copyResource(file.source, path.join(outputRoot, "web", file.relative));
    }
  }
  return files;
}

export async function bundledResourceFiles(desktopRoot) {
  const root = path.resolve(desktopRoot);
  const files = [];
  for (const group of packageDirectories) {
    for (const entry of await readdir(path.join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (entry.isSymbolicLink())
          throw new Error(`Bundled package cannot be a symlink: ${group}/${entry.name}`);
        continue;
      }
      const packageRoot = path.join(root, group, entry.name);
      const manifestFile = path.join(packageRoot, "extension.json");
      let manifestSource;
      try {
        manifestSource = await readFile(manifestFile, "utf8");
      } catch (error) {
        // Removed workspaces can leave ignored node_modules/build directories behind.
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const manifest = JSON.parse(manifestSource);
      await validateRuntimeResources(packageRoot, manifest);
      for (const resource of await readdir(packageRoot, { withFileTypes: true })) {
        if (resource.isSymbolicLink())
          throw new Error(`Bundled resource cannot be a symlink: ${resource.name}`);
        const include = resource.isDirectory()
          ? packageResources.has(resource.name)
          : resource.name === "extension.json" ||
            /^(?:LICENSE|NOTICE|THIRD_PARTY_NOTICES|README)(?:[._-]|$)/i.test(resource.name);
        if (!include) continue;
        await collectFiles(root, path.join(packageRoot, resource.name), files);
      }
    }
  }
  for (const group of resourceDirectories) await collectFiles(root, path.join(root, group), files);
  const settings = path.join(root, "features/settings/dist");
  try {
    if ((await lstat(settings)).isDirectory()) await collectFiles(root, settings, files);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function validateRuntimeResources(root, manifest) {
  const required = [manifest.runtime?.entry, manifest.ui?.entry];
  for (const contribution of [
    ...(manifest.contributes?.messageBlocks ?? []),
    ...(manifest.contributes?.fileEditors ?? []),
  ]) {
    required.push(contribution.module, contribution.style);
  }
  required.push(...(manifest.contributes?.skills ?? []).map((skill) => skill.path));
  required.push(...(manifest.contributes?.slashCommands ?? []).map((command) => command.workflow));
  for (const resource of required.filter(Boolean)) {
    if (!isSafeRelative(resource)) throw new Error(`Invalid bundled package resource: ${resource}`);
    const file = path.join(root, resource);
    await assertRegularFile(file);
  }
}

async function collectFiles(root, candidate, files) {
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error(`Bundled resource cannot be a symlink: ${candidate}`);
  if (stat.isDirectory()) {
    for (const entry of await readdir(candidate))
      await collectFiles(root, path.join(candidate, entry), files);
  } else if (stat.isFile()) {
    const relative = path.relative(root, candidate).split(path.sep).join("/");
    files.push({
      source: candidate,
      relative,
      browser: /^extensions\/[^/]+\/dist\/web\//.test(relative),
    });
  } else throw new Error(`Bundled resource must be a regular file: ${candidate}`);
}

async function copyResource(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  await chmod(target, (await lstat(source)).mode & 0o777);
}

/** Only extension browser builds are reachable through /extensions in the dev server. */
export async function browserResourceForRequest(root, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  } catch {
    return undefined;
  }
  if (!/^\/extensions\/[^/]+\/dist\/web\/.+/.test(pathname)) return undefined;
  const relative = pathname.slice(1);
  if (!isSafeRelative(relative)) return undefined;
  const candidate = path.join(root, relative);
  try {
    // Check each ancestor so symlinked directories cannot escape the package.
    let ancestor = path.resolve(root);
    for (const segment of relative.split("/")) {
      ancestor = path.join(ancestor, segment);
      if ((await lstat(ancestor)).isSymbolicLink()) return undefined;
    }
    await assertRegularFile(candidate);
    return candidate;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  }
}

function isSafeRelative(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

async function assertRegularFile(file) {
  if (!(await lstat(file)).isFile()) throw new Error(`Missing regular bundled resource: ${file}`);
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return (
    {
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".wasm": "application/wasm",
      ".woff2": "font/woff2",
    }[extension] ?? "application/octet-stream"
  );
}
