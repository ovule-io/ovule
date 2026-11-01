import type { GoalView, NodeView } from "@ovule/shell-api";

export function threadFamilyOwners(
  threadId: string | undefined,
  snapshot?: {
    goals: Pick<GoalView, "id" | "threadId">[];
    nodes: Pick<NodeView, "goalId" | "threadId">[];
  },
) {
  const node = snapshot?.nodes.find((item) => item.threadId === threadId);
  const parentId = snapshot?.goals.find((goal) => goal.id === node?.goalId)?.threadId ?? threadId;
  const goals = new Set(
    snapshot?.goals.filter((goal) => goal.threadId === parentId).map((goal) => goal.id),
  );
  return new Set([
    parentId,
    ...(snapshot?.nodes.filter((node) => goals.has(node.goalId)).map((node) => node.threadId) ??
      []),
  ]);
}
