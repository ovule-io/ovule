import { createObservable } from "@ovule/ioc/observable";
import type { ToolsStateService, ToolsStateServiceData } from "./state";
export function createToolsStateService() {
  return createObservable<ReturnType<ToolsStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
