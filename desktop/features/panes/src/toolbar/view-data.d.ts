import type { ConversationStateServiceData } from "@ovule/conversation/state";
import type { WorkspaceStateServiceData } from "@ovule/workspace/state";
import type { HostsStateServiceData } from "@ovule/hosts/state";
import type { TerminalStateServiceData } from "@ovule/terminal/state";
export type ViewData = { revision: bigint } & Pick<ConversationStateServiceData, "threads"> &
  Pick<WorkspaceStateServiceData, "bindings"> &
  Pick<HostsStateServiceData, "endpoints" | "hosts"> &
  Pick<TerminalStateServiceData, "terminalRuns">;
