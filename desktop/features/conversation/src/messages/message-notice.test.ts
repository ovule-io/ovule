import { expect, test } from "bun:test";
import type { ThreadMessageView } from "@ovule/shell-api";
import { messageNotice } from "./message-notice";
test("cancel notices preserve partial text and hide duplicate or legacy summaries", () => {
  const message = {
    role: "assistant",
    status: "cancelled",
    parts: [
      { kind: "markdown", text: "Partial reply" },
      { kind: "notice", text: "Generation stopped" },
    ],
  } as ThreadMessageView;
  expect(messageNotice(message).cancelled).toBe(true);
  expect(messageNotice(message).parts.map((part) => part.text)).toEqual(["Partial reply"]);
  const legacy = {
    role: "system",
    status: "error",
    parts: [{ kind: "markdown", text: "Agent Worker was cancelled before it started" }],
  } as ThreadMessageView;
  expect(messageNotice(legacy).cancelled).toBe(true);
  expect(messageNotice(legacy).parts).toEqual([]);
  expect(messageNotice({ ...legacy, role: "assistant", status: "complete" }).cancelled).toBe(false);
});
