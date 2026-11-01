import type { WorkspaceApi } from "./contract";
export type WorkspaceOperation = (
  api: Pick<WorkspaceApi, "setThreadWorkspace">,
) => ReturnType<WorkspaceApi["snapshot"]>;
