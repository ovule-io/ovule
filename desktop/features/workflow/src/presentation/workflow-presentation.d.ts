import type { ComponentType } from "react";
import type { AttemptView, GoalView, NodeView, ThreadMessageView } from "@ovule/shell-api";
export type WorkflowActivityProps = {
  goal: GoalView;
  nodes: NodeView[];
  attempts: AttemptView[];
  planningAttempts: AttemptView[];
  setupThreadId?: string;
  onOpenNode(id: string): void;
  onInspect(): void;
  onResolveGate(nodeId: string, approved: boolean): Promise<boolean>;
};
export type WorkflowPresentation = {
  Graph: ComponentType<{
    dialogOnly?: boolean;
    flat?: boolean;
    reviewGate?: { id: string; sequence: number };
    goal: GoalView;
    nodes: NodeView[];
    attempts: AttemptView[];
    onInspect?(): void;
    onOpenNode(threadId: string): void;
    onResolveGate?(nodeId: string, approved: boolean): Promise<boolean>;
  }>;
  Activities: ComponentType<WorkflowActivityProps>;
  ActiveCard: ComponentType<WorkflowActivityProps>;
  activityFor(
    goalId: string,
    nodes: NodeView[],
    attempts: AttemptView[],
    planningAttempts: AttemptView[],
  ): AttemptView[];
  setupThread(goalId: string, nodes: NodeView[], messages: ThreadMessageView[]): string | undefined;
};
