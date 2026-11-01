import type { ProjectView, WorkspaceBindingView } from "@ovule/shell-api";
export type WorkspaceStateServiceData = {
  revision: bigint;
  projects: ProjectView[];
  bindings: WorkspaceBindingView[];
};
export interface WorkspaceStateService {
  current(): {
    snapshot?: WorkspaceStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface WorkspaceStateController {
  service: WorkspaceStateService;
  stage(state: ReturnType<WorkspaceStateService["current"]>): void;
  patch(update: Partial<ReturnType<WorkspaceStateService["current"]>>): void;
  notify(): void;
}
