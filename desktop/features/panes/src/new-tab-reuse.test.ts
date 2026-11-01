import { expect, test } from "bun:test";
import { createPanesService } from "./service";
import type { PaneKind } from "./tab";
function panes() {
  let sequence = 0;
  return createPanesService({
    createId: () => String(++sequence),
    terminal: {
      current: () => ({ snapshot: { terminalRuns: [] } }),
      subscribe: () => () => {},
    } as never,
    layout: { openWorkbench() {} } as never,
  });
}
for (const kind of ["terminal", "workflow", "spice", "browser"] as PaneKind[]) {
  test(`New Tab becomes ${kind} without changing its identity, position or owner`, () => {
    const service = panes();
    const options = { placement: "thread" as const, threadId: "thread", newInstance: true };
    const first = service.openTab("browser", options);
    const second = service.openTab("browser", options);
    const id = service.openTab(kind, {
      ...options,
      replaceBlankId: first,
      shellProfileId: "zsh",
      target: kind === "browser" ? "file:///tmp/test.svg" : undefined,
    });
    expect(id).toBe(first);
    expect(service.current().instances.map((tab) => tab.id)).toEqual([first, second]);
    expect(service.current().instances[0]).toMatchObject({
      kind,
      threadId: "thread",
      shellProfileId: "zsh",
    });
    expect(service.current().activeThreadArtifacts.thread).toBe(first);
  });
}
test("late picker selection never replaces a New Tab that has already navigated", () => {
  const service = panes();
  const id = service.openTab("browser", { newInstance: true });
  service.updateTab(id, { target: "https://example.test" });
  const terminal = service.openTab("terminal", { replaceBlankId: id, newInstance: true });
  expect(terminal).not.toBe(id);
  expect(service.current().instances.find((tab) => tab.id === id)?.target).toBe(
    "https://example.test",
  );
});
