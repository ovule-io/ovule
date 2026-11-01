import workflowTokens from "./workflow.token";
import type { Register } from "@ovule/ioc";
import { WorkflowGraphCard } from "./presentation/WorkflowGraphCard";
import { WorkflowActivities } from "./presentation/ActiveWorkflowCard";
import { ActiveWorkflowCard } from "./presentation/ActiveWorkflowCard";
import { workflowActivityFor } from "./presentation/ActiveWorkflowCard";
import { workflowSetupThread } from "./presentation/ActiveWorkflowCard";
export default function register(register: Register): void {
  registerPresentationWorkflowPresentation(register);
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
