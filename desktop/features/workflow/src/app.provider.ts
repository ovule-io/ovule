import workflowTokens from "./workflow.token";
import type { Register } from "@ovule/ioc";
import { value } from "@ovule/ioc";
import { useGoalDraft } from "./useGoalDraft";
import { createWorkflowStateService } from "./state-service";
export default function register(register: Register): void {
  registerRoute(register);
  registerState(register);
}

function registerRoute(register: Register): void {
  register(workflowTokens.routeRuntime, value({ useGoalDraft }));
}

function registerState(register: Register): void {
  register(workflowTokens.stateController, () => createWorkflowStateService());
  register(
    workflowTokens.workflowState,
    (dependsOn) => dependsOn(workflowTokens.stateController).service,
  );
}
