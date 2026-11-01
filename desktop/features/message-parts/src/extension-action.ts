import type { WorkspaceService } from "@ovule/workspace/workspace";

export function isMessageBlockAction(action: unknown): action is string {
  return typeof action === "string" && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(action);
}

export async function runMessageBlockAction(
  workspace: Pick<WorkspaceService, "api" | "requestBrowserUse">,
  extensionId: string,
  detail: { action: string; connectionId?: string; threadId?: string },
  invalidJsonError: string,
  report: (result: { action: string; data?: unknown; error?: string; pending?: boolean }) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const api = await workspace.api();
    const input = {
      extensionId,
      actionId: detail.action,
      connectionId: detail.connectionId,
      threadId: detail.threadId,
    };
    let result = await api.runExtensionAction(input);
    const parse = (json: string): unknown => {
      try {
        return JSON.parse(json);
      } catch {
        throw new Error(invalidJsonError);
      }
    };
    let data = parse(result.dataJson);
    const deadline = Date.now() + 120_000;
    if (signal?.aborted) return;
    while (isPendingChannelAction(data, detail.connectionId)) {
      report({ action: detail.action, data, pending: true });
      if (Date.now() >= deadline)
        throw new Error("Bot setup is still running. Refresh to check its latest status.");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (signal?.aborted) return;
      result = await api.runExtensionAction({ ...input, actionId: "status" });
      if (signal?.aborted) return;
      data = parse(result.dataJson);
    }
    report({ action: detail.action, data });
    // A status poll can finish registration, but mounting/refreshing a card must
    // never reopen an old authorization URL.
    if (result.openUrl && !["refresh", "status", "bind-thread"].includes(detail.action))
      workspace.requestBrowserUse(result.openUrl);
  } catch (error) {
    if (signal?.aborted) return;
    report({
      action: detail.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isPendingChannelAction(data: unknown, connectionId?: string): boolean {
  if (
    !data ||
    typeof data !== "object" ||
    !("connections" in data) ||
    !Array.isArray(data.connections)
  )
    return false;
  return data.connections.some(
    (item) =>
      item &&
      typeof item === "object" &&
      (connectionId === undefined || item.connectionId === connectionId) &&
      ["registering", "refreshing"].includes(item.state),
  );
}
