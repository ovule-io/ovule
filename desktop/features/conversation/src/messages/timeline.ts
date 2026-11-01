import type { GoalView, ThreadMessageView } from "@ovule/shell-api";

/** Workflow parts durably associate a Goal with the Agent reply that created it. */
export function buildConversationTimeline(messages: ThreadMessageView[], goals: GoalView[]) {
  const attached = new Set<string>();
  const turns = messages.map((message) => {
    const workflows = (message.parts ?? []).flatMap((part) => {
      if (part.kind !== "workflow" || !part.dataJson) return [];
      try {
        const id = JSON.parse(part.dataJson).goalId;
        const goal = goals.find((goal) => goal.id === id);
        if (!goal || attached.has(id)) return [];
        attached.add(id);
        return [goal];
      } catch {
        return [];
      }
    });
    return {
      kind: "message" as const,
      at: message.createdAt,
      message,
      workflows,
    };
  });
  return [
    ...turns,
    ...goals
      .filter((goal) => !attached.has(goal.id))
      .map((goal) => ({
        kind: "workflow" as const,
        at: goal.createdAt,
        goal,
      })),
  ].sort((left, right) => left.at - right.at);
}
