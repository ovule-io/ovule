import type { ConversationStateServiceData } from "@ovule/conversation/state";
import type { HostsStateServiceData } from "./state";
import type { WorkspaceStateServiceData } from "@ovule/workspace/state";
import type { SettingsStateServiceData } from "@ovule/settings/settings/state";
import type { AgentsStateServiceData } from "@ovule/settings/agents/state";
export type ViewData = { revision: bigint } & Pick<ConversationStateServiceData, "threads"> &
  Pick<HostsStateServiceData, "endpoints"> &
  Pick<WorkspaceStateServiceData, "bindings"> &
  Pick<SettingsStateServiceData, "capabilities"> &
  Pick<AgentsStateServiceData, "agents">;
