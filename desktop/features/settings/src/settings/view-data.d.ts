import type { WorkspaceStateServiceData } from "@ovule/workspace/state";
import type { HostsStateServiceData } from "@ovule/hosts/state";
import type { SettingsStateServiceData } from "./state";
import type { AgentsStateServiceData } from "@ovule/settings/agents/state";
import type { ModelsStateServiceData } from "@ovule/settings/models/state";
import type { SkillsStateServiceData } from "@ovule/settings/skills/state";
import type { ToolsStateServiceData } from "@ovule/settings/tools/state";
import type { ConversationStateServiceData } from "@ovule/conversation/state";
export type ViewData = WorkspaceStateServiceData &
  HostsStateServiceData &
  SettingsStateServiceData & { revision: bigint } & Pick<AgentsStateServiceData, "agents"> &
  Pick<ModelsStateServiceData, "models"> &
  Pick<SkillsStateServiceData, "skills"> &
  Pick<ToolsStateServiceData, "tools"> &
  Pick<ConversationStateServiceData, "threads">;
