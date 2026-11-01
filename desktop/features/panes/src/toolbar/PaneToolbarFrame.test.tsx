import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { PaneToolbarFrame } from "./PaneToolbarFrame";

function positions(html: string, labels: string[]) {
  return labels.map((label) => html.indexOf(`>${label}<`));
}

describe("PaneToolbarFrame", () => {
  test("renders named slots in workspace order without wrapping the active slot in a button", () => {
    const labels = ["sidebar", "indicators", "add", "active", "actions"];
    const html = renderToStaticMarkup(
      <PaneToolbarFrame
        sidebarToggle={<span>sidebar</span>}
        tabIndicators={<span>indicators</span>}
        addTab={<span>add</span>}
        activeTab={<span>active</span>}
        tabOverlay={<span>overlay</span>}
        trailingActions={<span>actions</span>}
      />,
    );

    expect(positions(html, labels)).toEqual([...positions(html, labels)].sort((a, b) => a - b));
    expect(html).not.toContain("<button");
    expect(html.match(/data-titlebar-divider/g)).toHaveLength(2);
    expect(html).toContain('data-titlebar-region="tabs"');
    expect(html).toContain('data-titlebar-slot="tab-indicators"');
    expect(html.indexOf(">overlay<")).toBeLessThan(html.indexOf(">actions<"));
  });

  test("omits empty optional slots and their trailing divider", () => {
    const html = renderToStaticMarkup(
      <PaneToolbarFrame
        sidebarToggle={<span>sidebar</span>}
        addTab={<span>add</span>}
        activeTab={<span>active</span>}
      />,
    );

    expect(html).not.toContain('data-titlebar-slot="tab-indicators"');
    expect(html).not.toContain('data-titlebar-slot="trailing-actions"');
    expect(html.match(/data-titlebar-divider/g)).toHaveLength(1);
  });

  test("keeps hover actions in layout so their hit targets do not move", async () => {
    const css = await Bun.file(new URL("./PaneToolbar.module.css", import.meta.url)).text();
    const actions = css.match(/\.paneActiveTabActions\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(actions).toContain("flex: none");
    expect(actions).not.toContain("max-width: 0");
  });
});

test("workspace groups sidebar and add before the divider and omits indicators", () => {
  const html = renderToStaticMarkup(
    <PaneToolbarFrame
      variant="workspace"
      sidebarToggle={<span>sidebar</span>}
      addTab={<span>add</span>}
      tabIndicators={<span>indicators</span>}
      activeTab={<span>browser</span>}
      trailingActions={<span>workbench</span>}
    />,
  );
  expect(html).toContain('data-toolbar-variant="workspace"');
  expect(html).not.toContain(">indicators<");
  expect(html.indexOf(">add<")).toBeLessThan(html.indexOf("data-titlebar-divider"));
  expect(html.indexOf("data-titlebar-divider")).toBeLessThan(html.indexOf(">browser<"));
  expect(html.match(/data-titlebar-divider/g)).toHaveLength(2);
});
