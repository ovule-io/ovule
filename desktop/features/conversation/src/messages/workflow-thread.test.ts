import { expect, test } from "bun:test";
import { buildConversationTimeline } from "./timeline";
import type { ThreadMessageView, GoalView } from "@ovule/shell-api";
const at = (value: number) => new Date(value);
test("mixes multiple Workflow cards with Conversation Thread messages by creation time", () => {
  const messages = [
    { id: "message-1", createdAt: at(1) },
    { id: "message-2", createdAt: at(4) },
  ] as ThreadMessageView[];
  const goals = [
    { id: "workflow-1", createdAt: at(2) },
    { id: "workflow-2", createdAt: at(3) },
  ] as GoalView[];

  expect(
    buildConversationTimeline(messages, goals).map((item) =>
      item.kind === "message" ? item.message.id : item.goal.id,
    ),
  ).toEqual(["message-1", "workflow-1", "workflow-2", "message-2"]);
});
test("renders active Agent state only through the message surface", async () => {
  const messageList = await Bun.file(new URL("./MessageList.tsx", import.meta.url)).text();
  expect(messageList).not.toContain("data-thread-attempt");
  expect(messageList).not.toContain("activityCard");
  expect(messageList).toContain('message.status === "streaming"');
  expect(messageList).not.toContain('className={cn("spin"');
});
