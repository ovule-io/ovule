const isNative =
  typeof window !== "undefined" &&
  typeof (globalThis as typeof globalThis & { tuffite?: { invoke?: unknown } }).tuffite?.invoke ===
    "function";
import type { WorkspaceApi } from "./contract";

export function workspaceBindingUrl(protocol: string, origin: string, baseUrl: string): string {
  if (protocol === "ovule:") return "ovule://-/shell_api.js";
  return new URL("shell_api.js", origin + baseUrl).href;
}

export type WorkspaceAdapterEnvironment = {
  native: boolean;
  protocol: string;
  loadBinding(): Promise<WorkspaceApi | undefined>;
  mock: WorkspaceApi | (() => Promise<WorkspaceApi>);
};

let nativeWorkspaceApi: Promise<WorkspaceApi> | undefined;

export async function resolveWorkspaceApi(
  environment: WorkspaceAdapterEnvironment,
): Promise<WorkspaceApi> {
  const bridge = environment.native ? await environment.loadBinding() : undefined;
  if (bridge) return bridge;
  if (!matchesWebPrototype(environment.protocol)) {
    throw new Error("Tuffite native bridge is unavailable for the packaged Ovule document");
  }
  return typeof environment.mock === "function" ? environment.mock() : environment.mock;
}

export async function workspaceApi(): Promise<WorkspaceApi> {
  nativeWorkspaceApi ??= resolveWorkspaceApi({
    native: isNative,
    protocol: location.protocol,
    loadBinding: async () => {
      const api = await import("@ovule/shell-api");
      return {
        ...api.workspace,
        ...api.extensions,
        ...api.setup,
        ...api.workflow,
        ...api.message,
        ...api.content,
        ...api.terminal,
        ...api.settings,
      };
    },
    mock: () => import("./mock-adapter").then((module) => module.mockWorkspaceApi),
  });
  return nativeWorkspaceApi;
}

function matchesWebPrototype(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}
