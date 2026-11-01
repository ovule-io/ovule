import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import conversationTokens from "./conversation.token";
import type { Register } from "@ovule/ioc";
import { createMessagePresentationRegistry } from "./messages/service";
import { MessageList } from "./messages/MessageList.tsx";
import conversationStyles from "./messages/ConversationPane.module.css";
import { createComposerService } from "./composer/service";
import { defaultComposerSuggestions } from "./composer/suggestion-service";
import { createComposerSuggestionRegistry } from "./composer/suggestions-contract";
export default function register(register: Register): void {
  registerComposerThread(register);
  registerMessageList(register);
  registerMessagesRoute(register);
}

function registerComposerThread(register: Register): void {
  register(conversationTokens.composer, () => createComposerService());
  register(conversationTokens.composerSuggestionRegistry, () => {
    const registry = createComposerSuggestionRegistry();
    registry.register(defaultComposerSuggestions);
    return registry;
  });
}

function registerMessageList(register: Register): void {
  register(conversationTokens.messagePresentationRegistry, (dependsOn) => {
    const registry = createMessagePresentationRegistry();
    dependsOn(messagePartsTokens.runtime).registerDefaults(registry);
    return registry;
  });
}

function registerMessagesRoute(register: Register): void {
  register(conversationTokens.messageRouteRuntime, (dependsOn) => {
    const workflow = dependsOn(workflowTokens.presentation);
    const parts = dependsOn(messagePartsTokens.runtime);
    return {
      ActiveWorkflowCard: workflow.ActiveCard,
      workflowSetupThread: workflow.setupThread,
      initializeExtensionMessageBlocks: parts.initialize,
      MessageList,
      conversationStyles,
    };
  });
}
