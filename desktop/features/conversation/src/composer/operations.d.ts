import type { WorkspaceApi } from "@ovule/workspace/contract";
export type WorkspaceOperation = (
  api: Pick<
    WorkspaceApi,
    | "extensionCatalog"
    | "createThread"
    | "selectHost"
    | "selectAgent"
    | "sendMessageWithAttachments"
    | "sendMessage"
  >,
) => ReturnType<WorkspaceApi["snapshot"]>;
