import type { CapabilityView, LegacyDataIssueView } from "@ovule/shell-api";
export type SettingsStateServiceData = {
  revision: bigint;
  capabilities: CapabilityView[];
  legacyDataIssues: LegacyDataIssueView[];
};
export interface SettingsStateService {
  current(): {
    snapshot?: SettingsStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface SettingsStateController {
  service: SettingsStateService;
  stage(state: ReturnType<SettingsStateService["current"]>): void;
  patch(update: Partial<ReturnType<SettingsStateService["current"]>>): void;
  notify(): void;
}
