import type { AgentsStateServiceData } from "@ovule/settings/agents/state";
import type { ModelsStateServiceData } from "@ovule/settings/models/state";
export type ViewData = { revision: bigint } & Pick<AgentsStateServiceData, "agents"> &
  Pick<ModelsStateServiceData, "models">;
