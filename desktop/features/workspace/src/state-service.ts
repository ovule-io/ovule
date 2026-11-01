import { createObservable } from "@ovule/ioc/observable";
import type { WorkspaceStateService, WorkspaceStateServiceData } from "./state";
export function createWorkspaceStateService() {
  return createObservable<ReturnType<WorkspaceStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
