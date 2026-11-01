import type { AttemptView, ThreadMessageView, ThreadView } from "@ovule/shell-api";
import type { PaneInstance } from "@ovule/panes/tab";
import type { WorkspaceApi } from "@ovule/workspace/contract";

export function visibleThreadTabs(
  tabs: PaneInstance[],
  expanded: boolean,
  activeId?: string,
): PaneInstance[] {
  return expanded ? tabs : tabs.filter((tab) => tab.id === activeId);
}
export function runningThreadIds(attempts: readonly AttemptView[]): Set<string> {
  return new Set(
    attempts
      .filter((attempt) =>
        ["queued", "running", "cancelling", "dispatched"].includes(attempt.status),
      )
      .map((attempt) => attempt.threadId),
  );
}
export async function forkConversation(
  api: WorkspaceApi,
  thread: ThreadView,
  messages: readonly ThreadMessageView[],
  existingThreadIds: readonly string[],
) {
  const last = messages.filter((message) => message.threadId === thread.id).at(-1);
  if (last) return api.forkMessage(thread.id, last.id);
  let snapshot = await api.createThread({ workspacePath: thread.workspacePath || undefined });
  const id = snapshot.threads.find((item) => !existingThreadIds.includes(item.id))?.id;
  if (!id || id === thread.id) throw new Error("Created Thread was not returned");
  snapshot = await api.selectHost(id, thread.hostId);
  snapshot = await api.selectAgent(id, thread.agent);
  if (thread.projectId) snapshot = await api.moveThreadToProject(id, thread.projectId);
  if (thread.workspaceBindingIds.length)
    snapshot = await api.setThreadWorkspaceBindings(id, thread.workspaceBindingIds);
  return { threadId: id, snapshot };
}
