import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarTabIcon } from "./SidebarTabIcon";
import type { PaneInstance } from "@ovule/panes/tab";

test("web icon uses the page favicon and falls back to that origin's favicon URL", () => {
  const tab = {
    kind: "browser",
    url: "https://example.com/page",
    favicon: "https://example.com/custom.png",
  } as PaneInstance;
  const html = renderToStaticMarkup(<SidebarTabIcon tab={tab} />);
  expect(html).toContain('data-icon-source="favicon"');
  expect(html).toContain('src="https://example.com/custom.png"');
  expect(html).not.toContain("data-tab-icon");
  expect(renderToStaticMarkup(<SidebarTabIcon tab={{ ...tab, favicon: undefined }} />)).toContain(
    'src="https://example.com/favicon.ico"',
  );
});
test("new tabs and internal tools use Lucide even when stale favicon metadata exists", () => {
  for (const kind of ["browser", "terminal", "workflow"] as const) {
    const html = renderToStaticMarkup(
      <SidebarTabIcon tab={{ kind, favicon: "https://example.com/favicon.ico" } as PaneInstance} />,
    );
    expect(html).toContain('data-icon-source="lucide"');
    expect(html).not.toContain("<img");
  }
});
test("file URLs use themed Catppuccin file-type icons instead of web favicons", () => {
  const html = renderToStaticMarkup(
    <SidebarTabIcon
      tab={
        {
          kind: "browser",
          url: "file:///tmp/diagram.png",
          favicon: "https://example.com/favicon.ico",
        } as PaneInstance
      }
    />,
  );
  expect(html).toContain('data-icon-source="catppuccin"');
  expect(html).toContain('data-tab-icon="image"');
  expect(html).not.toContain("https://example.com");
});

test("source tabs render language artwork even with a stale web favicon", () => {
  const html = renderToStaticMarkup(
    <SidebarTabIcon
      tab={
        {
          kind: "browser",
          url: `ovule://${"c".repeat(48)}.local/code?url=file:///tmp/app.tsx`,
          favicon: "https://example.com/favicon.ico",
        } as PaneInstance
      }
    />,
  );
  expect(html).toContain('data-icon-source="catppuccin"');
  expect(html).toContain('data-tab-icon="typescript-react"');
  expect(html).not.toContain("https://example.com");
});
