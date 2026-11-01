import type { WorkspaceApi } from "@ovule/workspace/contract";
export type WorkspaceOperation = (
  api: Pick<WorkspaceApi, "delegateTask" | "resolveGate" | "sendMessage">,
) => ReturnType<WorkspaceApi["snapshot"]>;
