import { createObservable } from "@ovule/ioc/observable";
import type { TerminalStateService, TerminalStateServiceData } from "./state";
export function createTerminalStateService() {
  return createObservable<ReturnType<TerminalStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
