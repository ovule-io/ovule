import { expect, test } from "bun:test";
import type { GoalView, ThreadMessageView } from "@ovule/shell-api";
import { buildConversationTimeline } from "./timeline";
import { createMessagePresentationRegistry } from "./service";

test("a persisted workflow belongs to its Agent reply even when timestamps change", () => {
  const goal = { id: "goal", createdAt: new Date(0) } as GoalView;
  const message = {
    id: "reply",
    createdAt: new Date(100),
    parts: [{ id: "workflow", kind: "workflow", dataJson: '{"goalId":"goal"}' }],
  } as ThreadMessageView;
  const timeline = buildConversationTimeline([message], [goal]);
  expect(timeline).toHaveLength(1);
  expect(timeline[0].kind).toBe("message");
  if (timeline[0].kind === "message") expect(timeline[0].workflows).toEqual([goal]);
});

test("legacy Goals remain visible and malformed parts cannot break the timeline", () => {
  const goal = { id: "legacy", createdAt: new Date(0) } as GoalView;
  const message = {
    id: "reply",
    createdAt: new Date(100),
    parts: [{ kind: "workflow", dataJson: "{" }],
  } as ThreadMessageView;
  expect(buildConversationTimeline([message], [goal])).toHaveLength(2);
});

test("late extension registration and removal notify message renderers", () => {
  const registry = createMessagePresentationRegistry();
  let updates = 0;
  const unsubscribe = registry.subscribe(() => updates++);
  const unregister = registry.registerRenderer("channel-setup", () => null);
  expect(updates).toBe(1);
  expect(registry.revision()).toBe(1);
  unregister();
  expect(updates).toBe(2);
  unsubscribe();
});
