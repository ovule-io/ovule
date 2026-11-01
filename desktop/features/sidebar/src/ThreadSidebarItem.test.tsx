import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThreadSidebarItem, ArtifactTabs, type ThreadTreeModel } from "./ThreadSidebarItem";
import type { ThreadView } from "@ovule/shell-api";
import type { PaneInstance } from "@ovule/panes/tab";
const thread = { id: "thread", title: "Conversation" } as ThreadView;
const model: ThreadTreeModel = {
  selectedThreadId: "thread",
  activeArtifacts: { thread: "b" },
  tabs: [
    { id: "a", title: "Hidden tab", threadId: "thread", placement: "thread" },
    { id: "b", title: "Active tab", threadId: "thread", placement: "thread" },
  ] as PaneInstance[],
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
test("conversation starts collapsed while retaining its active tab and an accessible menu trigger", () => {
  const html = renderToStaticMarkup(<ThreadSidebarItem thread={thread} model={model} />);
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('data-tab-id="b"');
  expect(html).not.toContain('data-tab-id="a"');
  expect(html).toContain("sidebar.threadMenu");
  expect(html).not.toContain("lucide-message-square-text");
  expect(html.indexOf('data-thread-id="thread"')).toBeLessThan(html.indexOf("sidebar.expandTabs"));
  expect(html.indexOf("sidebar.threadMenu")).toBeLessThan(html.indexOf("sidebar.expandTabs"));
});
test("a remembered artifact in a different conversation is not shown as the current tab", () => {
  const html = renderToStaticMarkup(
    <ThreadSidebarItem thread={thread} model={{ ...model, selectedThreadId: "other" }} />,
  );
  expect(html).not.toContain('data-tab-id="b"');
});
test("running agent exposes a button even while its action menu is closed", () => {
  const html = renderToStaticMarkup(
    <ThreadSidebarItem thread={thread} model={{ ...model, running: new Set(["thread"]) }} />,
  );
  expect(html).toContain("sidebar.agentRunning");
  expect(html).toMatch(/class="[^"]*lucide-loader-circle[^"]* spin"/);
});
test("collapsing a parent retains the selected workflow child and its current artifact", () => {
  const child = { id: "child", title: "Child conversation" } as ThreadView;
  const html = renderToStaticMarkup(
    <ThreadSidebarItem
      thread={thread}
      model={{
        ...model,
        selectedThreadId: "child",
        nodeThreads: [{ thread: child, parentThreadId: "thread" }],
        activeArtifacts: { child: "child-tab" },
        tabs: [
          {
            id: "child-tab",
            title: "Child tab",
            threadId: "child",
            placement: "thread",
          } as PaneInstance,
        ],
      }}
    />,
  );
  expect(html).toContain('data-thread-group="child"');
  expect(html).toContain('data-tab-id="child-tab"');
});

test("conversations without children have no reserved expansion button", () => {
  const html = renderToStaticMarkup(
    <ThreadSidebarItem thread={thread} model={{ ...model, tabs: [], nodeThreads: [] }} />,
  );
  expect(html).not.toContain("sidebar.expandTabs");
  expect(html).not.toContain("sidebar.collapseTabs");
  expect(html).toContain("sidebar.threadMenu");
});

test("unbound tabs use a root list instead of nesting beneath New Conversation", () => {
  const tab = {
    id: "draft-tab",
    draftId: "draft",
    kind: "browser",
    placement: "thread",
    title: "New tab",
  } as PaneInstance;
  const html = renderToStaticMarkup(
    <ArtifactTabs tabs={[tab]} ownerId="draft" model={model} nested={false} />,
  );
  expect(html).toContain('data-slot="sidebar-menu"');
  expect(html).not.toContain('data-slot="sidebar-menu-sub"');
  expect(html).toContain('data-tab-id="draft-tab"');
});
