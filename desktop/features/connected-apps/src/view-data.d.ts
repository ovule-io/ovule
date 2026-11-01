import type { AgentsStateServiceData } from "@ovule/settings/agents/state";
import type { ToolsStateServiceData } from "@ovule/settings/tools/state";
export type ViewData = { revision: bigint } & Pick<AgentsStateServiceData, "agents"> &
  Pick<ToolsStateServiceData, "tools">;
