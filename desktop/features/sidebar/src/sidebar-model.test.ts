import { expect, test } from "bun:test";
import { forkConversation, runningThreadIds, visibleThreadTabs } from "./sidebar-model";
import { createSidebarPreferences } from "./sidebar-preferences";
import type { AttemptView, ThreadMessageView, ThreadView } from "@ovule/shell-api";
import type { PaneInstance } from "@ovule/panes/tab";
import type { WorkspaceApi } from "@ovule/workspace/contract";

test("collapsed child tabs retain only the selected artifact", () => {
  const tabs = [{ id: "a" }, { id: "b" }] as PaneInstance[];
  expect(visibleThreadTabs(tabs, false)).toEqual([]);
  expect(visibleThreadTabs(tabs, false, "b")).toEqual([tabs[1]]);
  expect(visibleThreadTabs(tabs, true, "b")).toEqual(tabs);
  expect(visibleThreadTabs(tabs, false, "closed-tab")).toEqual([]);
});
test("running threads exclude settled attempts and include dispatched agents", () => {
  const attempts = [
    "queued",
    "dispatched",
    "running",
    "cancelling",
    "succeeded",
    "failed",
    "cancelled",
  ].map((status, index) => ({ threadId: String(index), status })) as AttemptView[];
  expect([...runningThreadIds(attempts)]).toEqual(["0", "1", "2", "3"]);
});
test("archive preferences persist, deduplicate, and restore without losing conversation data", () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const state = createSidebarPreferences(storage);
  state.setArchived("thread", true);
  state.setArchived("thread", true);
  expect(createSidebarPreferences(storage).current().archived).toEqual(["thread"]);
  state.setArchived("thread", false);
  expect(createSidebarPreferences(storage).current().archived).toEqual([]);
});
test("invalid archive preferences cannot prevent sidebar startup", () => {
  expect(
    createSidebarPreferences({ getItem: () => "broken JSON", setItem() {} }).current().archived,
  ).toEqual([]);
  expect(
    createSidebarPreferences({ getItem: () => '["thread",3,null]', setItem() {} }).current()
      .archived,
  ).toEqual(["thread"]);
});
const thread = {
  id: "original",
  workspacePath: "/work",
  agent: "agent",
  hostId: "host",
  projectId: "project",
  workspaceBindingIds: ["binding"],
} as ThreadView;
test("fork uses the selected conversation's latest history message", async () => {
  const calls: unknown[] = [];
  const api = {
    forkMessage: async (...args: unknown[]) => {
      calls.push(args);
      return { threadId: "fork", snapshot: {} };
    },
  } as unknown as WorkspaceApi;
  const messages = [
    { id: "first", threadId: "original" },
    { id: "last", threadId: "original" },
    { id: "other", threadId: "other" },
  ] as ThreadMessageView[];
  expect((await forkConversation(api, thread, messages, ["original"])).threadId).toBe("fork");
  expect(calls).toEqual([["original", "last"]]);
});
test("fork of an empty conversation identifies its new ID and copies workspace, host and agent", async () => {
  const calls: unknown[] = [];
  const snapshot = { threads: [{ id: "fork" }, { id: "original" }] };
  const api = Object.fromEntries(
    [
      "createThread",
      "selectHost",
      "selectAgent",
      "moveThreadToProject",
      "setThreadWorkspaceBindings",
    ].map((name) => [
      name,
      async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return snapshot;
      },
    ]),
  ) as unknown as WorkspaceApi;
  expect((await forkConversation(api, thread, [], ["original"])).threadId).toBe("fork");
  expect(calls).toEqual([
    ["createThread", { workspacePath: "/work" }],
    ["selectHost", "fork", "host"],
    ["selectAgent", "fork", "agent"],
    ["moveThreadToProject", "fork", "project"],
    ["setThreadWorkspaceBindings", "fork", ["binding"]],
  ]);
});
