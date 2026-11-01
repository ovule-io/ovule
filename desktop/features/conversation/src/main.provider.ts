import conversationTokens from "./conversation.token";
import type { Register } from "@ovule/ioc";
import { ConversationFactory } from "./ConversationView";
export default function register(register: Register): void {
  registerConversationView(register);
}

function registerConversationView(register: Register): void {
  register(conversationTokens.conversationView, (dependsOn) => dependsOn(ConversationFactory));
}
