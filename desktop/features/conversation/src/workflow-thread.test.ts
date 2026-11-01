import { expect, test } from "bun:test";
import { useConversationProjection } from "./useConversationProjection";
import type { AppSnapshot } from "@ovule/shell-api";
const at = (value: number) => value;
test("projects a Workflow Node Thread without exposing it as a Conversation Thread", () => {
  const snapshot = {
    threads: [
      {
        id: "conversation",
        title: "Conversation",
        agent: "sample",
        hostId: "local",
      },
      {
        id: "node-thread",
        title: "Remote build",
        agent: "codex",
        hostId: "remote",
      },
    ],
    goals: [{ id: "goal", threadId: "conversation", createdAt: at(2) }],
    nodes: [{ id: "node", goalId: "goal", threadId: "node-thread", createdAt: at(3) }],
    messages: [{ id: "node-message", threadId: "node-thread" }],
    attempts: [{ id: "attempt", threadId: "node-thread", taskId: "node" }],
  } as AppSnapshot;

  const projection = useConversationProjection(snapshot, "node-thread", undefined);

  expect(projection.nodeThread?.id).toBe("node");
  expect(projection.goal?.id).toBe("goal");
  expect(projection.goals.map((goal) => goal.id)).toEqual(["goal"]);
  expect(projection.messages.map((message) => message.id)).toEqual(["node-message"]);
  expect(projection.visibleThreads.map((thread) => thread.id)).toEqual(["conversation"]);
});
test("loads typed Shell API module exports without installing a business global", async () => {
  const adapter = await Bun.file(
    new URL("../../workspace/src/native-adapter.ts", import.meta.url),
  ).text();
  expect(adapter).toContain('import("@ovule/shell-api")');
  expect(adapter).not.toContain("window.ovule");
});

test("thread switching reuses indexed message buckets and immutable updates invalidate them", () => {
  const snapshot = {
    threads: [{ id: "a" }, { id: "b" }],
    goals: [],
    nodes: [],
    attempts: [],
    messages: Array.from({ length: 10000 }, (_, index) => ({
      id: String(index),
      threadId: index % 2 ? "a" : "b",
    })),
  } as unknown as AppSnapshot;
  const first = useConversationProjection(snapshot, "a", undefined);
  expect(first.messages).toHaveLength(5000);
  expect(useConversationProjection(snapshot, "b", undefined).messages).toHaveLength(5000);
  expect(useConversationProjection(snapshot, "a", undefined).messages).toBe(first.messages);
  const updated = {
    ...snapshot,
    messages: [...snapshot.messages, { id: "new", threadId: "a" } as never],
  };
  const next = useConversationProjection(updated, "a", undefined);
  expect(next.messages).toHaveLength(5001);
  expect(next.messages.at(-1)?.id).toBe("new");
  expect(first.messages).toHaveLength(5000);
});
