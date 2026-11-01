import { describe, expect, test } from "bun:test";
import { reduceTerminalInput } from "./terminal-input";

describe("terminal input reducer", () => {
  test("inserts, moves and deletes at the cursor", () => {
    expect(reduceTerminalInput({ command: "ac", cursor: 1 }, "b")).toMatchObject({
      kind: "draft",
      draft: { command: "abc", cursor: 2 },
    });
    expect(reduceTerminalInput({ command: "abc", cursor: 2 }, "\u007f")).toMatchObject({
      draft: { command: "ac", cursor: 1 },
    });
    expect(reduceTerminalInput({ command: "abc", cursor: 1 }, "\x1b[3~")).toMatchObject({
      draft: { command: "ac", cursor: 1 },
    });
  });

  test("maps navigation and history keys without side effects", () => {
    expect(reduceTerminalInput({ command: "abc", cursor: 2 }, "\u0001")).toMatchObject({
      draft: { cursor: 0 },
    });
    expect(reduceTerminalInput({ command: "abc", cursor: 2 }, "\u0005")).toMatchObject({
      draft: { cursor: 3 },
    });
    expect(reduceTerminalInput({ command: "abc", cursor: 2 }, "\x1b[A")).toEqual({
      kind: "history",
      direction: -1,
    });
  });
});
