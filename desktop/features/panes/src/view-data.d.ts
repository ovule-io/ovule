import type { WorkflowStateServiceData } from "@ovule/workflow/state";
import type { WorkspaceStateServiceData } from "@ovule/workspace/state";
import type { TerminalStateServiceData } from "@ovule/terminal/state";
import type { HostsStateServiceData } from "@ovule/hosts/state";
export type ViewData = WorkflowStateServiceData &
  WorkspaceStateServiceData &
  TerminalStateServiceData &
  HostsStateServiceData;
