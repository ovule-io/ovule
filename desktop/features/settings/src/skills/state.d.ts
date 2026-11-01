import type { SkillView } from "@ovule/shell-api";
export type SkillsStateServiceData = { revision: bigint; skills: SkillView[] };
export interface SkillsStateService {
  current(): {
    snapshot?: SkillsStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface SkillsStateController {
  service: SkillsStateService;
  stage(state: ReturnType<SkillsStateService["current"]>): void;
  patch(update: Partial<ReturnType<SkillsStateService["current"]>>): void;
  notify(): void;
}
