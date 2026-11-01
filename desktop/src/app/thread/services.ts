import registerSettings from "@ovule/settings/thread.provider";
import registerMessageParts from "@ovule/message-parts/thread.provider";
import registerWorkflow from "@ovule/workflow/thread.provider";
import type { Registry } from "@ovule/ioc-container";
import registerConversation from "@ovule/conversation/thread.provider";
export function registerThreadServices(registry: Registry): Registry {
  const register = registry.register.bind(registry);
  registerMessageParts(register);
  registerWorkflow(register);
  registerConversation(register);
  registerSettings(register);
  return registry;
}
