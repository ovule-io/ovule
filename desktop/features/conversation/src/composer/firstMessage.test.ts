import { describe, expect, test } from "bun:test";

import { sendFirstMessage } from "./firstMessage";

describe("sendFirstMessage", () => {
  test("creates a thread, applies the draft agent, then sends", async () => {
    const calls: string[] = [];
    const snapshot = { threads: [{ id: "existing" }, { id: "thread-1" }] };
    const result = await sendFirstMessage({
      api: {
        createThread: async () => {
          calls.push("createThread");
          return snapshot;
        },
        selectAgent: async (threadId, agentId) => {
          calls.push(`selectAgent:${agentId}`);
          expect(threadId).toBe("thread-1");
          return snapshot;
        },
        selectHost: async () => snapshot,
      },
      existingThreadIds: new Set(["existing"]),
      draftAgentId: "codex",
      send: async (threadId) => {
        calls.push(`sendMessage:${threadId}`);
        return snapshot;
      },
    });

    expect(calls).toEqual(["createThread", "selectAgent:codex", "sendMessage:thread-1"]);
    expect(result.threadId).toBe("thread-1");
  });

  test("skips agent selection when the draft has no agent", async () => {
    const calls: string[] = [];
    const snapshot = { threads: [{ id: "thread-1" }] };
    await sendFirstMessage({
      api: {
        createThread: async () => {
          calls.push("createThread");
          return snapshot;
        },
        selectAgent: async () => {
          calls.push("selectAgent");
          return snapshot;
        },
        selectHost: async () => snapshot,
      },
      existingThreadIds: new Set(),
      send: async () => {
        calls.push("sendMessage");
        return snapshot;
      },
    });

    expect(calls).toEqual(["createThread", "sendMessage"]);
  });

  test("selects a remote host before the draft agent", async () => {
    const calls: string[] = [];
    const snapshot = { threads: [{ id: "thread-1" }] };
    await sendFirstMessage({
      api: {
        createThread: async () => {
          calls.push("createThread");
          return snapshot;
        },
        selectHost: async (_threadId, hostId) => {
          calls.push(`selectHost:${hostId}`);
          return snapshot;
        },
        selectAgent: async (_threadId, agentId) => {
          calls.push(`selectAgent:${agentId}`);
          return snapshot;
        },
      },
      existingThreadIds: new Set(),
      draftHostId: "host-remote",
      draftAgentId: "codex",
      send: async () => {
        calls.push("sendMessage");
        return snapshot;
      },
    });
    expect(calls).toEqual([
      "createThread",
      "selectHost:host-remote",
      "selectAgent:codex",
      "sendMessage",
    ]);
  });
});
