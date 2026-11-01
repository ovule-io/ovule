import type { TerminalRunView } from "@ovule/shell-api";
export type TerminalStateServiceData = {
  revision: bigint;
  terminalRuns: TerminalRunView[];
};
export interface TerminalStateService {
  current(): {
    snapshot?: TerminalStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface TerminalStateController {
  service: TerminalStateService;
  stage(state: ReturnType<TerminalStateService["current"]>): void;
  patch(update: Partial<ReturnType<TerminalStateService["current"]>>): void;
  notify(): void;
}
