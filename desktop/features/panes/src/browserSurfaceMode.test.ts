import { describe, expect, test } from "bun:test";

import { browserSurfaceMode } from "./browserSurfaceMode";

describe("browserSurfaceMode", () => {
  test("keeps a blank browser in its pane so later navigation reaches the visible surface", () => {
    const initialMode = browserSurfaceMode({ kind: "browser" });

    expect(initialMode).toBe("pane");
    expect(initialMode).toBe("pane");
  });

  test("uses a direct surface when a browser opens with a target", () => {
    expect(browserSurfaceMode({ kind: "browser", target: "https://example.com" })).toBe("direct");
    expect(browserSurfaceMode({ kind: "files", target: "/tmp/example.html" })).toBe("pane");
  });
});
