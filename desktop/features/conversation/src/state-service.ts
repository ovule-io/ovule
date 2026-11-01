import { createObservable } from "@ovule/ioc/observable";
import type { ConversationStateService, ConversationStateServiceData } from "./state";
export function createConversationStateService() {
  return createObservable<ReturnType<ConversationStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
