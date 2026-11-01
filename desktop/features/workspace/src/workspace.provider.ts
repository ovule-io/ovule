import workspaceTokens from "./workspace.token";
import { value, type Register } from "@ovule/ioc";
import { createWorkspaceStateService } from "./state-service";
import type { WorkspaceService } from "./workspace";
import { observeAgentOutput } from "./events";
import { observeBrowserUse } from "./events";
import { observeHumanHandoff } from "./events";
import { observeOfficeUse } from "./events";
import { observeOllamaModelChanged } from "./events";
import { observeTerminalOutput } from "./events";
import { observeToolchainChanged } from "./events";
import { observeWorkspace } from "./events";
import { requestBrowserUse } from "./events";
import { requestHumanHandoff } from "./events";
import { requestOfficeUse } from "./events";
import { workspaceApi } from "./native-adapter";

export default function register(
  register: Register,
  overrides: { workspace?: WorkspaceService } = {},
): void {
  registerState(register);
  registerWorkspace(register, overrides);
}
function registerState(register: Register): void {
  register(workspaceTokens.stateController, () => createWorkspaceStateService());
  register(
    workspaceTokens.workspaceState,
    (dependsOn) => dependsOn(workspaceTokens.stateController).service,
  );
}

const defaultWorkspaceService: WorkspaceService = {
  api: workspaceApi,
  observeWorkspace,
  observeAgentOutput,
  observeTerminalOutput,
  observeBrowserUse,
  observeHumanHandoff,
  observeOfficeUse,
  observeToolchainChanged,
  observeOllamaModelChanged,
  requestBrowserUse,
  requestHumanHandoff,
  requestOfficeUse,
};

function registerWorkspace(
  register: Register,
  overrides: {
    workspace?: WorkspaceService;
  } = {},
): void {
  register(workspaceTokens.workspace, value(overrides.workspace ?? defaultWorkspaceService));
}
