import type { ConversationStateServiceData } from "@ovule/conversation/state";
import type { SkillsStateServiceData } from "@ovule/settings/skills/state";
export type ViewData = { revision: bigint } & Pick<ConversationStateServiceData, "threads"> &
  Pick<SkillsStateServiceData, "skills">;
