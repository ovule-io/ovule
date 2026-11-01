import { expect, test } from "bun:test";
import { createDomainGraph } from "./snapshot-sync";
import { createCompositionFixture } from "../../tests/domain-graph";
import type { AppSnapshot } from "@ovule/shell-api";
import type { WorkspaceApi } from "@ovule/workspace/contract";
function snapshot(revision: bigint): AppSnapshot {
  return {
    revision,
    threads: [{ id: "thread" }],
    messages: [],
    goals: [],
    nodes: [],
    attempts: [],
    terminalRuns: [],
    projects: [],
    bindings: [],
    hosts: [],
    endpoints: [],
    agents: [],
    models: [],
    skills: [],
    tools: [],
    capabilities: [],
    legacyDataIssues: [],
  } as unknown as AppSnapshot;
}
function graph(api: Partial<WorkspaceApi> = {}) {
  const { selection, stores } = createCompositionFixture();
  return createDomainGraph({ api: async () => api as WorkspaceApi }, selection, stores);
}
test("a subscriber observes a coherent batch and stale snapshots cannot roll back any domain", () => {
  const value = graph();
  const seen: bigint[] = [];
  value.stores.conversation.service.subscribe(() => {
    seen.push(value.stores.workflow.service.current().snapshot!.revision);
    expect(value.stores.hosts.service.current().snapshot!.revision).toBe(
      value.stores.conversation.service.current().snapshot!.revision,
    );
  });
  value.sync.acceptSnapshot(snapshot(3n));
  value.sync.acceptSnapshot(snapshot(2n));
  expect(seen).toEqual([3n]);
  expect(value.stores.conversation.service.current().snapshot!.revision).toBe(3n);
});
test("pending work belongs to its domain and concurrent operations drain independently", async () => {
  let finish!: (value: AppSnapshot) => void;
  const value = graph({
    createThread: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    resetWorkflows: async () => snapshot(2n),
  });
  const first = value.sync.invoke((api) => api.createThread({}));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(value.stores.conversation.service.current().pending).toBe(1);
  expect(value.stores.hosts.service.current().busy).toBe(false);
  expect(await value.sync.invoke((api) => api.resetWorkflows())).toBe(true);
  expect(value.stores.workflow.service.current().busy).toBe(false);
  expect(value.stores.conversation.service.current().busy).toBe(true);
  finish(snapshot(1n));
  await first;
  expect(value.stores.conversation.service.current().pending).toBe(0);
  expect(value.stores.conversation.service.current().snapshot!.revision).toBe(2n);
});
test("failure stays in the affected domain", async () => {
  const value = graph({
    createThread: async () => {
      throw new Error("thread unavailable");
    },
  });
  expect(await value.sync.invoke((api) => api.createThread({}))).toBe(false);
  expect(value.stores.conversation.service.current().error).toBe("thread unavailable");
  expect(value.stores.hosts.service.current().error).toBeUndefined();
});
test("stream updates stage workflow and conversation together, ignore duplicates and reload gaps", async () => {
  let loads = 0;
  const initial = snapshot(1n);
  initial.attempts = [{ id: "attempt", output: "", outputSequence: 0n }] as AppSnapshot["attempts"];
  initial.messages = [
    {
      attemptId: "attempt",
      role: "assistant",
      status: "streaming",
      content: "",
      parts: [{ kind: "markdown", text: "" }],
      streamSequence: 0n,
    },
  ] as AppSnapshot["messages"];
  const value = graph({
    snapshot: async () => {
      loads++;
      return { ...initial, revision: 5n };
    },
  });
  value.sync.acceptSnapshot(initial);
  value.stores.workflow.service.subscribe(() => {
    expect(value.stores.conversation.service.current().snapshot!.revision).toBe(
      value.stores.workflow.service.current().snapshot!.revision,
    );
  });
  const event = { attemptId: "attempt", sequence: 0, delta: "hello", revision: 2 };
  value.sync.appendAgentOutput(event);
  value.sync.appendAgentOutput(event);
  expect(value.stores.conversation.service.current().snapshot!.messages[0].content).toBe("hello");
  expect(value.stores.workflow.service.current().snapshot!.attempts[0].output).toBe("hello");
  value.sync.appendAgentOutput({ ...event, sequence: 3, revision: 4 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(loads).toBe(1);
});

test("thread host and agent selection report conversation status without marking a trailing snapshot as workspace work", async () => {
  const value = graph({
    selectAgent: async () => snapshot(1n),
    selectHost: async () => snapshot(2n),
    snapshot: async () => snapshot(3n),
  });
  const touched: string[] = [];
  for (const [domain, store] of Object.entries(value.stores)) {
    store.service.subscribe(() => {
      if (store.service.current().busy) touched.push(domain);
    });
  }
  expect(
    await value.sync.invoke(async (api) => {
      await api.selectAgent("thread", "agent");
      await api.selectHost("thread", "host");
      return api.snapshot();
    }),
  ).toBe(true);
  expect(new Set(touched)).toEqual(new Set(["conversation"]));
});

test("thinking invalidations keep one snapshot in flight and fetch the final revision", async () => {
  const pending: Array<(value: AppSnapshot) => void> = [];
  let calls = 0;
  const value = graph({
    snapshot: () => {
      calls++;
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const first = value.sync.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 1000; i++) void value.sync.load();
  expect(calls).toBe(1);
  pending.shift()!(snapshot(10n));
  await first;
  expect(value.stores.conversation.service.current().snapshot!.revision).toBe(10n);
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(calls).toBe(2);
  pending.shift()!(snapshot(1001n));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(2);
  expect(value.stores.conversation.service.current().snapshot!.revision).toBe(1001n);
  const next = value.sync.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  pending.shift()!(snapshot(1002n));
  await next;
  expect(calls).toBe(3);
});
