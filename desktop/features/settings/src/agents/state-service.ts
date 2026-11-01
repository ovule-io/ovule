import { createObservable } from "@ovule/ioc/observable";
import type { AgentsStateService, AgentsStateServiceData } from "./state";
export function createAgentsStateService() {
  return createObservable<ReturnType<AgentsStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
