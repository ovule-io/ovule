import type { ConversationStateServiceData } from "@ovule/conversation/state";
import type { TerminalStateServiceData } from "@ovule/terminal/state";
import type { WorkflowStateServiceData } from "@ovule/workflow/state";
export type ViewData = { revision: bigint } & Pick<
  ConversationStateServiceData,
  "threads" | "messages"
> &
  Pick<TerminalStateServiceData, "terminalRuns"> &
  Pick<WorkflowStateServiceData, "nodes" | "goals" | "attempts">;
