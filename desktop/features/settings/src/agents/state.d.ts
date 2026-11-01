import type { AgentView } from "@ovule/shell-api";
export type AgentsStateServiceData = { revision: bigint; agents: AgentView[] };
export interface AgentsStateService {
  current(): {
    snapshot?: AgentsStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface AgentsStateController {
  service: AgentsStateService;
  stage(state: ReturnType<AgentsStateService["current"]>): void;
  patch(update: Partial<ReturnType<AgentsStateService["current"]>>): void;
  notify(): void;
}
