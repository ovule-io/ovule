import conversationTokens from "@ovule/conversation/conversation.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import terminalTokens from "@ovule/terminal/terminal.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import hostsTokens from "@ovule/hosts/hosts.token";
import settingsTokens from "@ovule/settings/settings.token";
import { createRegistry, createScope } from "@ovule/ioc-container";
import { registerDesktopServices } from "../src/app/services";
import type { DomainControllers } from "../src/app/snapshot-sync";

export function createCompositionFixture() {
  const scope = createScope(registerDesktopServices(createRegistry()));
  const stores: DomainControllers = {
    conversation: scope.get(conversationTokens.stateController),
    workflow: scope.get(workflowTokens.stateController),
    terminal: scope.get(terminalTokens.stateController),
    workspace: scope.get(workspaceTokens.stateController),
    hosts: scope.get(hostsTokens.stateController),
    agents: scope.get(settingsTokens.agentsStateController),
    models: scope.get(settingsTokens.modelsStateController),
    skills: scope.get(settingsTokens.skillsStateController),
    tools: scope.get(settingsTokens.toolsStateController),
    settings: scope.get(settingsTokens.settingsStateController),
  };
  return { scope, stores, selection: scope.get(conversationTokens.selection) };
}
