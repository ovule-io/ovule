import type { ToolView } from "@ovule/shell-api";
export type ToolsStateServiceData = { revision: bigint; tools: ToolView[] };
export interface ToolsStateService {
  current(): {
    snapshot?: ToolsStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface ToolsStateController {
  service: ToolsStateService;
  stage(state: ReturnType<ToolsStateService["current"]>): void;
  patch(update: Partial<ReturnType<ToolsStateService["current"]>>): void;
  notify(): void;
}
