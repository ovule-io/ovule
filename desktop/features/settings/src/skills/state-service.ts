import { createObservable } from "@ovule/ioc/observable";
import type { SkillsStateService, SkillsStateServiceData } from "./state";
export function createSkillsStateService() {
  return createObservable<ReturnType<SkillsStateService["current"]>>({
    pending: 0,
    busy: false,
  });
}
