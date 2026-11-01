import { createObservable } from "@ovule/ioc/observable";
import type { SettingsStateService, SettingsStateServiceData } from "./state";
export function createSettingsStateService() {
  return createObservable<ReturnType<SettingsStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
