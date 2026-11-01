import { expect, test } from "bun:test";
import { isWorkbenchKind } from "./workbench-kind";

test("remote desktop survives the Thread-to-root pane-kind check", () => {
  expect(isWorkbenchKind("spice")).toBe(true);
  for (const kind of ["workflow", "browser", "files", "markdown", "office", "terminal", "handoff"])
    expect(isWorkbenchKind(kind)).toBe(true);
});
test("unknown and inherited property names are not pane kinds", () => {
  for (const kind of [undefined, null, {}, 1, "search", "constructor", "toString", "__proto__"])
    expect(isWorkbenchKind(kind)).toBe(false);
});
