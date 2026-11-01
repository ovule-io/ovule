import { createObservable } from "@ovule/ioc/observable";
import type { ModelsStateService, ModelsStateServiceData } from "./state";
export function createModelsStateService() {
  return createObservable<ReturnType<ModelsStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
