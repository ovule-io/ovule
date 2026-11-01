import { loadExternalModule } from "./load-external-module";
import { tuffiteMessageApi, requestRoot } from "./explorer-platform";
import { isNative } from "./native";
import type { OpenFileDialogOptions, OpenDirectoryDialogOptions, DialogApi } from "./dialog";

let loading: Promise<DialogApi> | undefined;

export function dialogApi(): Promise<DialogApi> {
  if (
    ["pane", "thread"].includes(document.documentElement.dataset.surface ?? "") &&
    tuffiteMessageApi()
  ) {
    return Promise.resolve({
      saveFile: async (options, contents) =>
        (await requestRoot<{ path?: string }>("dialog.saveFile", { options, contents })).path,
      openFile: async (options) =>
        (await requestRoot<{ path?: string }>("dialog.openFile", options ?? {})).path,
      openDirectory: async (options) =>
        (await requestRoot<{ path?: string }>("dialog.openDirectory", options ?? {})).path,
    });
  }
  if (loading) return loading;
  if (!isNative) {
    return Promise.resolve({
      saveFile: async () => {
        throw new Error("Native save dialog is unavailable");
      },
      openFile: async () => undefined,
      openDirectory: async () => undefined,
    });
  }
  loading = (async () => {
    const { dialog } = (await loadExternalModule("/tuffite.js")) as {
      dialog: {
        saveFile(options: OpenFileDialogOptions, contents: Uint8Array): Promise<string | null>;
        openFile(options?: OpenFileDialogOptions): Promise<string | null>;
        openDirectory(options?: OpenDirectoryDialogOptions): Promise<string | null>;
      };
    };
    return {
      saveFile: async (options, contents) =>
        (await dialog.saveFile(options, Uint8Array.from(contents))) ?? undefined,
      openFile: async (options) => (await dialog.openFile(options)) ?? undefined,
      openDirectory: async (options) => (await dialog.openDirectory(options)) ?? undefined,
    };
  })();
  return loading;
}

export function workspaceRelativePath(
  workspacePath: string,
  selectedPath: string,
): string | undefined {
  const normalize = (value: string) => {
    let normalized = value.replaceAll("/", "\\").replace(/\\+$/, "");
    if (normalized.startsWith("\\\\?\\")) normalized = normalized.slice(4);
    return normalized;
  };
  const workspace = normalize(workspacePath);
  const selected = normalize(selectedPath);
  if (selected.toLocaleLowerCase() === workspace.toLocaleLowerCase()) return ".";
  const prefix = `${workspace}\\`;
  return selected.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? selected.slice(prefix.length)
    : undefined;
}

export function workspaceCandidatePath(workspacePath: string, value: string): string {
  const trimmed = value.trim();
  if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(trimmed)) return trimmed;
  const separator = workspacePath.includes("\\") ? "\\" : "/";
  return `${workspacePath.replace(/[\\/]+$/, "")}${separator}${trimmed.replace(/^[\\/]+/, "")}`;
}
