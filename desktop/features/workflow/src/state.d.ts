import type { GoalView, NodeView, AttemptView } from "@ovule/shell-api";
export type WorkflowStateServiceData = {
  revision: bigint;
  goals: GoalView[];
  nodes: NodeView[];
  attempts: AttemptView[];
};
export interface WorkflowStateService {
  current(): {
    snapshot?: WorkflowStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface WorkflowStateController {
  service: WorkflowStateService;
  stage(state: ReturnType<WorkflowStateService["current"]>): void;
  patch(update: Partial<ReturnType<WorkflowStateService["current"]>>): void;
  notify(): void;
}
