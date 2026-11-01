import type { WorkspaceApi } from "@ovule/workspace/contract";
export type WorkspaceOperation = (
  api: Pick<
    WorkspaceApi,
    | "testWorkspaceLink"
    | "registerEndpoint"
    | "bindWorkspace"
    | "selectHost"
    | "submitWorkspaceLinkPairing"
    | "shareHostLink"
    | "regenerateHostLink"
    | "unbindRemoteHost"
    | "removeRemoteHost"
    | "resetLinkHosts"
    | "repairLocalHostAccess"
    | "resetLocalHostLinkIdentity"
    | "setWorkspaceLinkAccess"
    | "shareWorkspaceLink"
    | "revokeWorkspaceLink"
    | "unbindWorkspace"
  >,
) => ReturnType<WorkspaceApi["snapshot"]>;
