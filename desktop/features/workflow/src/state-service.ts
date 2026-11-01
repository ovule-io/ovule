import { createObservable } from "@ovule/ioc/observable";
import type { WorkflowStateService, WorkflowStateServiceData } from "./state";
export function createWorkflowStateService() {
  return createObservable<ReturnType<WorkflowStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
