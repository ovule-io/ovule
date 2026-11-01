import type { WorkflowStateServiceData } from "./state";
import type { HostsStateServiceData } from "@ovule/hosts/state";
import type { WorkspaceStateServiceData } from "@ovule/workspace/state";
export type ViewData = { revision: bigint } & Pick<WorkflowStateServiceData, "nodes" | "attempts"> &
  Pick<HostsStateServiceData, "hosts"> &
  Pick<WorkspaceStateServiceData, "bindings">;
