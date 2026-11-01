import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TabsSidebarGroup } from "./TabsSidebarGroup";
import type { ThreadTreeModel } from "./ThreadSidebarItem";
import type { PaneInstance } from "@ovule/panes/tab";
const tab = {
  id: "tab",
  kind: "browser",
  title: "New tab",
  placement: "thread",
  draftId: "draft",
} as PaneInstance;
const model: ThreadTreeModel = {
  tabs: [tab],
  activeArtifacts: {},
  nodeThreads: [],
  running: new Set(),
  archived: [],
  selectThread() {},
  selectTab() {},
  closeTab() {},
  moveTab() {},
  canClose: () => true,
  renderTabIcon: () => null,
  setArchived() {},
  fork: async () => {},
  addTab() {},
};
test("Tabs group shows accessible clear and collapse buttons in its header", () => {
  const html = renderToStaticMarkup(
    <TabsSidebarGroup tabs={[tab]} draftId="draft" model={model} />,
  );
  expect(html).toContain("data-sidebar-tabs");
  expect(html).toContain('aria-label="sidebar.clearTabs"');
  expect(html).toContain('aria-label="sidebar.collapseTabGroup"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('data-tab-id="tab"');
  expect(html.indexOf("sidebar.clearTabs")).toBeLessThan(html.indexOf('data-tab-id="tab"'));
});
test("Tabs cannot be cleared when every item is a running terminal", () => {
  const html = renderToStaticMarkup(
    <TabsSidebarGroup tabs={[tab]} draftId="draft" model={{ ...model, canClose: () => false }} />,
  );
  expect(html).toMatch(/aria-label="sidebar.clearTabs" disabled=""/);
  expect(renderToStaticMarkup(<TabsSidebarGroup tabs={[]} draftId="draft" model={model} />)).toBe(
    "",
  );
});

test("tabs moved to the workbench disappear from the sidebar group and its clear actions", () => {
  const workbenchTab = { ...tab, id: "workbench-tab", placement: "workbench" } as PaneInstance;
  const html = renderToStaticMarkup(
    <TabsSidebarGroup tabs={[tab, workbenchTab]} draftId="draft" model={model} />,
  );
  expect(html).toContain('data-tab-id="tab"');
  expect(html).not.toContain('data-tab-id="workbench-tab"');
  expect(
    renderToStaticMarkup(<TabsSidebarGroup tabs={[workbenchTab]} draftId="draft" model={model} />),
  ).toBe("");
  const disabled = renderToStaticMarkup(
    <TabsSidebarGroup
      tabs={[tab, workbenchTab]}
      draftId="draft"
      model={{ ...model, canClose: (item) => item.id === workbenchTab.id }}
    />,
  );
  expect(disabled).toMatch(/aria-label="sidebar.clearTabs" disabled=""/);
});
