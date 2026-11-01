import { createObservable } from "@ovule/ioc/observable";
import type { HostsStateService, HostsStateServiceData } from "./state";
export function createHostsStateService() {
  return createObservable<ReturnType<HostsStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
