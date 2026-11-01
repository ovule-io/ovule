import type { ModelsStateServiceData } from "./state";
import type { AgentsStateServiceData } from "@ovule/settings/agents/state";
export type ViewData = { revision: bigint } & Pick<ModelsStateServiceData, "models"> &
  Pick<AgentsStateServiceData, "agents">;
