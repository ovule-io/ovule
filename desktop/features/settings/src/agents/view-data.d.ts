import type { ModelsStateServiceData } from "@ovule/settings/models/state";
import type { SkillsStateServiceData } from "@ovule/settings/skills/state";
import type { ToolsStateServiceData } from "@ovule/settings/tools/state";
import type { AgentsStateServiceData } from "./state";
export type ViewData = { revision: bigint } & Pick<ModelsStateServiceData, "models"> &
  Pick<SkillsStateServiceData, "skills"> &
  Pick<ToolsStateServiceData, "tools"> &
  Pick<AgentsStateServiceData, "agents">;
