import { expect, test } from "bun:test";
import type { PaneContext } from "@ovule/panes/pane";
import { paneWorkspacePath } from "./pane-workspace";

function context(ids: string[], explicit?: string) {
  return {
    workspaceBindingId: explicit,
    thread: { workspaceBindingIds: ids, workspacePath: "/internal/default" },
    snapshot: {
      bindings: [
        { id: "first", root: "/work/one" },
        { id: "second", root: "/work/two" },
      ],
    },
  } as Pick<PaneContext, "workspaceBindingId" | "thread" | "snapshot">;
}
test("uses the selected binding before the thread's first binding", () => {
  expect(paneWorkspacePath(context(["first"], "second"))).toBe("/work/two");
  expect(paneWorkspacePath(context(["first"]))).toBe("/work/one");
});
test("unbound and stale bindings defer to the native HOME default", () => {
  expect(paneWorkspacePath(context([]))).toBeUndefined();
  expect(paneWorkspacePath(context(["removed"]))).toBeUndefined();
});
