import type { ModelView } from "@ovule/shell-api";
export type ModelsStateServiceData = { revision: bigint; models: ModelView[] };
export interface ModelsStateService {
  current(): {
    snapshot?: ModelsStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface ModelsStateController {
  service: ModelsStateService;
  stage(state: ReturnType<ModelsStateService["current"]>): void;
  patch(update: Partial<ReturnType<ModelsStateService["current"]>>): void;
  notify(): void;
}
