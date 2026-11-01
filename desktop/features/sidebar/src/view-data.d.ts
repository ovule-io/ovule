import type { TerminalStateServiceData } from "@ovule/terminal/state";
import type { WorkspaceStateServiceData } from "@ovule/workspace/state";
import type { ConversationStateServiceData } from "@ovule/conversation/state";
import type { WorkflowStateServiceData } from "@ovule/workflow/state";
export type ViewData = { revision: bigint } & Pick<TerminalStateServiceData, "terminalRuns"> &
  Pick<WorkspaceStateServiceData, "projects"> &
  Pick<ConversationStateServiceData, "threads"> &
  Pick<WorkflowStateServiceData, "nodes">;
