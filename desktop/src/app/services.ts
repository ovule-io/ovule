import conversationTokens from "@ovule/conversation/conversation.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import terminalTokens from "@ovule/terminal/terminal.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import hostsTokens from "@ovule/hosts/hosts.token";
import settingsTokens from "@ovule/settings/settings.token";
import shellTokens from "@ovule/shell/shell.token";
import registerSidebar from "@ovule/sidebar/app.provider";
import registerPanes from "@ovule/panes/app.provider";
import registerFramework from "@ovule/framework/app.provider";
import registerBrowser from "@ovule/browser/app.provider";

import { create } from "@ovule/ioc";
import type { Registry } from "@ovule/ioc-container";
import { createDomainGraph } from "./snapshot-sync";
import registerConversation from "@ovule/conversation/app.provider";
import registerWorkflow from "@ovule/workflow/app.provider";
import registerTerminal from "@ovule/terminal/app.provider";

import registerHosts from "@ovule/hosts/app.provider";
import registerSettings from "@ovule/settings/app.provider";

import registerWorkspace from "@ovule/workspace/workspace.provider";
import registerShell from "@ovule/shell/app.provider";
import registerRemoting from "@ovule/remoting/app.provider";
import registerI18n from "@ovule/i18n/i18n.provider";
import registerMessageParts from "@ovule/message-parts/app.provider";
import type { RemoteControlService } from "@ovule/remoting/remoting";
import type { WorkspaceService } from "@ovule/workspace/workspace";
import type { ShellService } from "@ovule/shell/shell";
export type DesktopServiceOverrides = {
  remoteControl?: RemoteControlService;
  workspace?: WorkspaceService;
  shell?: ShellService;
};

export function registerDesktopServices(
  registry: Registry,
  overrides: DesktopServiceOverrides = {},
): Registry {
  const register = registry.register.bind(registry);
  registerWorkspace(register, overrides);
  registerShell(register, { overrides });
  registerRemoting(register, { overrides });
  registerI18n(register);
  registerMessageParts(register);
  registerConversation(register);
  registerWorkflow(register);
  registerTerminal(register);

  registerHosts(register);
  registerSettings(register);

  registerFramework(register);
  registerSidebar(register);
  registerPanes(register);
  registerBrowser(register);

  registry.register(DomainGraphFactory);
  register(shellTokens.snapshotSync, (dependsOn) => dependsOn(DomainGraphFactory).sync);
  return registry;
}

const DomainGraphFactory = create(
  (dependsOn) =>
    createDomainGraph(
      dependsOn(workspaceTokens.workspace),
      dependsOn(conversationTokens.selection),
      {
        conversation: dependsOn(conversationTokens.stateController),
        workflow: dependsOn(workflowTokens.stateController),
        terminal: dependsOn(terminalTokens.stateController),
        workspace: dependsOn(workspaceTokens.stateController),
        hosts: dependsOn(hostsTokens.stateController),
        agents: dependsOn(settingsTokens.agentsStateController),
        models: dependsOn(settingsTokens.modelsStateController),
        skills: dependsOn(settingsTokens.skillsStateController),
        tools: dependsOn(settingsTokens.toolsStateController),
        settings: dependsOn(settingsTokens.settingsStateController),
      },
    ),
  "DomainGraph",
);
