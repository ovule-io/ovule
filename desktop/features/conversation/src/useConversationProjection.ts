import type { ViewData } from "@ovule/conversation/view-data";

function groupBy<T>(key: (item: T) => string | undefined) {
  const cache = new WeakMap<T[], Map<string | undefined, T[]>>();
  const empty: T[] = [];
  return (items: T[] | undefined, value: string | undefined): T[] => {
    if (!items) return empty;
    let groups = cache.get(items);
    if (!groups) {
      groups = new Map();
      for (const item of items) {
        const id = key(item);
        const group = groups.get(id);
        if (group) group.push(item);
        else groups.set(id, [item]);
      }
      cache.set(items, groups);
    }
    return groups.get(value) ?? empty;
  };
}
const messagesForThread = groupBy<ViewData["messages"][number]>((item) => item.threadId);
const goalsForThread = groupBy<ViewData["goals"][number]>((item) => item.threadId);
const attemptsForThread = groupBy<ViewData["attempts"][number]>((item) =>
  item.taskId ? undefined : item.threadId,
);

export function useConversationProjection(
  snapshot: ViewData | undefined,
  selectedThreadId: string | undefined,
  selectedGoalId: string | undefined,
  includeConversation = true,
) {
  const thread =
    selectedThreadId === ""
      ? undefined
      : (snapshot?.threads.find((item) => item.id === selectedThreadId) ?? snapshot?.threads[0]);
  const nodeThread = snapshot?.nodes.find((node) => node.threadId === thread?.id);
  const parentGoals = goalsForThread(snapshot?.goals, thread?.id);
  const nodeGoal = snapshot?.goals.find((item) => item.id === nodeThread?.goalId);
  const goal = nodeGoal ?? parentGoals.find((item) => item.id === selectedGoalId) ?? parentGoals[0];
  const nodes = snapshot?.nodes.filter((node) => node.goalId === goal?.id) ?? [];
  const attempts =
    snapshot?.attempts.filter((attempt) => nodes.some((node) => node.id === attempt.taskId)) ?? [];
  const messages = includeConversation ? messagesForThread(snapshot?.messages, thread?.id) : [];
  const threadAttempts =
    includeConversation && thread ? attemptsForThread(snapshot?.attempts, thread?.id) : [];
  const visibleGoals = nodeGoal ? [nodeGoal, ...parentGoals] : parentGoals;
  const workflowNodes =
    snapshot?.nodes.filter((node) => visibleGoals.some((goal) => goal.id === node.goalId)) ?? [];
  const workflowAttempts =
    snapshot?.attempts.filter((attempt) =>
      workflowNodes.some((node) => node.id === attempt.taskId),
    ) ?? [];
  const nodeThreadIds = new Set(snapshot?.nodes.map((node) => node.threadId).filter(Boolean));
  const visibleThreads = snapshot?.threads.filter((item) => !nodeThreadIds.has(item.id)) ?? [];
  return {
    thread,
    goal,
    goals: visibleGoals,
    nodes,
    attempts,
    workflowNodes,
    workflowAttempts,
    messages,
    threadAttempts,
    visibleThreads,
    nodeThread,
  };
}
