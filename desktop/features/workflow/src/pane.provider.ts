import workflowTokens from "./workflow.token";
import type { Register } from "@ovule/ioc";
import { workflowPaneDefinition } from "./pane";
import { WorkflowGraphCard } from "./presentation/WorkflowGraphCard";
import { WorkflowActivities } from "./presentation/ActiveWorkflowCard";
import { ActiveWorkflowCard } from "./presentation/ActiveWorkflowCard";
import { workflowActivityFor } from "./presentation/ActiveWorkflowCard";
import { workflowSetupThread } from "./presentation/ActiveWorkflowCard";
export default function register(register: Register): void {
  registerPane(register);
  registerPresentationWorkflowPresentation(register);
}

function registerPane(register: Register): void {
  register(workflowTokens.paneDefinition, (dependsOn) =>
    workflowPaneDefinition(dependsOn(workflowTokens.presentation)),
  );
}

function registerPresentationWorkflowPresentation(register: Register): void {
  register(workflowTokens.presentation, () => ({
    Graph: WorkflowGraphCard,
    Activities: WorkflowActivities,
    ActiveCard: ActiveWorkflowCard,
    activityFor: workflowActivityFor,
    setupThread: workflowSetupThread,
  }));
}
