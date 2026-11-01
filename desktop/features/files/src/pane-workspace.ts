import type { PaneContext } from "@ovule/panes/pane";

/** Internal fallback workspaces are not user bindings and must not steer file dialogs. */
export function paneWorkspacePath(
  context: Pick<PaneContext, "workspaceBindingId" | "thread" | "snapshot">,
): string | undefined {
  const id = context.workspaceBindingId ?? context.thread?.workspaceBindingIds[0];
  return id ? context.snapshot.bindings.find((binding) => binding.id === id)?.root : undefined;
}
