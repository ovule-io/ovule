import { describe, expect, test } from "bun:test";

import { createPaneRegistry } from "./registry";

const Pane = () => null;

describe("pane registry", () => {
  test("supports registration, replacement and browser fallback", () => {
    const registry = createPaneRegistry();
    registry.register({ kind: "browser", component: Pane });
    registry.register({ kind: "terminal", component: Pane });
    expect(registry.resolve("terminal").kind).toBe("terminal");
    expect(registry.resolve("unknown").kind).toBe("browser");
    expect(registry.list()).toHaveLength(2);
  });
});
