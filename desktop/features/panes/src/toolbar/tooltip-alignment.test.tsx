import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Tooltip } from "@ovule/ui/tooltip";

describe("Tooltip boundary alignment", () => {
  test("exposes inward start and end alignment to CSS", () => {
    const start = renderToStaticMarkup(
      <Tooltip content="Show sidebar" side="bottom" align="start">
        <span>toggle</span>
      </Tooltip>,
    );
    const end = renderToStaticMarkup(
      <Tooltip content="Open in Workbench" side="bottom" align="end">
        <span>open</span>
      </Tooltip>,
    );

    expect(start).toContain('data-align="start"');
    expect(end).toContain('data-align="end"');
  });
});
