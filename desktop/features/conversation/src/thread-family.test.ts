import { describe, expect, test } from "bun:test";
import { threadFamilyOwners } from "./thread-family";

describe("conversation artifact ownership", () => {
  const snapshot = {
    goals: [
      { id: "goal", threadId: "parent" },
      { id: "other", threadId: "unrelated" },
    ],
    nodes: [
      { goalId: "goal", threadId: "first" },
      { goalId: "goal", threadId: "second" },
      { goalId: "other", threadId: "foreign" },
    ],
  };
  test("parent and node surfaces expose the same sibling artifact family", () => {
    expect([...threadFamilyOwners("parent", snapshot)]).toEqual(["parent", "first", "second"]);
    expect(threadFamilyOwners("first", snapshot)).toEqual(threadFamilyOwners("parent", snapshot));
    expect(threadFamilyOwners("first", snapshot).has("foreign")).toBe(false);
  });
  test("a conversation without workflow data retains only its own artifacts", () => {
    expect([...threadFamilyOwners("plain")]).toEqual(["plain"]);
  });
});
