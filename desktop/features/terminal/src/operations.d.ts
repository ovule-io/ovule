import type { WorkspaceApi } from "@ovule/workspace/contract";
export type WorkspaceOperation = (
  api: Pick<WorkspaceApi, "startTerminal" | "cancelTerminal">,
) => ReturnType<WorkspaceApi["snapshot"]>;
