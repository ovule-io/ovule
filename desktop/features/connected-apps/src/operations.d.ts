import type { WorkspaceApi } from "@ovule/workspace/contract";
export type WorkspaceOperation = (
  api: Pick<WorkspaceApi, "upsertTool" | "upsertAgent" | "removeTool">,
) => ReturnType<WorkspaceApi["snapshot"]>;
