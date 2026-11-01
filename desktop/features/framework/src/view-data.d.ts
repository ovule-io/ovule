import type { ConversationStateServiceData } from "@ovule/conversation/state";
export type ViewData = { revision: bigint } & Pick<ConversationStateServiceData, "threads">;
