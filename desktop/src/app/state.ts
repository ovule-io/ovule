import shellTokens from "@ovule/shell/shell.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import terminalTokens from "@ovule/terminal/terminal.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import hostsTokens from "@ovule/hosts/hosts.token";
import settingsTokens from "@ovule/settings/settings.token";
import { create } from "@ovule/ioc";
import { projectServices } from "@ovule/ioc/observable";

export const DesktopStateFactory = create((dependsOn) => {
  const sync = dependsOn(shellTokens.snapshotSync);
  const conversation = dependsOn(conversationTokens.conversationState);
  const workflow = dependsOn(workflowTokens.workflowState);
  const terminal = dependsOn(terminalTokens.terminalState);
  const workspace = dependsOn(workspaceTokens.workspaceState);
  const hosts = dependsOn(hostsTokens.hostsState);
  const agents = dependsOn(settingsTokens.agentsState);
  const models = dependsOn(settingsTokens.modelsState);
  const skills = dependsOn(settingsTokens.skillsState);
  const tools = dependsOn(settingsTokens.toolsState);
  const settings = dependsOn(settingsTokens.settingsState);
  const reader = projectServices(
    [
      conversation,
      workflow,
      terminal,
      workspace,
      hosts,
      agents,
      models,
      skills,
      tools,
      settings,
    ] as const,
    (
      conversationState,
      workflowState,
      terminalState,
      workspaceState,
      hostsState,
      agentsState,
      modelsState,
      skillsState,
      toolsState,
      settingsState,
    ) => ({
      snapshot:
        conversationState.snapshot &&
        workflowState.snapshot &&
        terminalState.snapshot &&
        workspaceState.snapshot &&
        hostsState.snapshot &&
        agentsState.snapshot &&
        modelsState.snapshot &&
        skillsState.snapshot &&
        toolsState.snapshot &&
        settingsState.snapshot
          ? {
              ...conversationState.snapshot,
              ...workflowState.snapshot,
              ...terminalState.snapshot,
              ...workspaceState.snapshot,
              ...hostsState.snapshot,
              ...agentsState.snapshot,
              ...modelsState.snapshot,
              ...skillsState.snapshot,
              ...toolsState.snapshot,
              ...settingsState.snapshot,
              revision: [
                conversationState.snapshot.revision,
                workflowState.snapshot.revision,
                terminalState.snapshot.revision,
                workspaceState.snapshot.revision,
                hostsState.snapshot.revision,
                agentsState.snapshot.revision,
                modelsState.snapshot.revision,
                skillsState.snapshot.revision,
                toolsState.snapshot.revision,
                settingsState.snapshot.revision,
              ].reduce((latest, value) => (value > latest ? value : latest), 0n),
            }
          : undefined,
      pending:
        conversationState.pending +
        workflowState.pending +
        terminalState.pending +
        workspaceState.pending +
        hostsState.pending +
        agentsState.pending +
        modelsState.pending +
        skillsState.pending +
        toolsState.pending +
        settingsState.pending,
      busy:
        conversationState.busy ||
        workflowState.busy ||
        terminalState.busy ||
        workspaceState.busy ||
        hostsState.busy ||
        agentsState.busy ||
        modelsState.busy ||
        skillsState.busy ||
        toolsState.busy ||
        settingsState.busy,
      error:
        conversationState.error ??
        workflowState.error ??
        terminalState.error ??
        workspaceState.error ??
        hostsState.error ??
        agentsState.error ??
        modelsState.error ??
        skillsState.error ??
        toolsState.error ??
        settingsState.error,
    }),
  );
  return { ...reader, ...sync };
}, "DesktopStateProjection");
export type DesktopState = import("@ovule/ioc").ServiceOf<typeof DesktopStateFactory>;
