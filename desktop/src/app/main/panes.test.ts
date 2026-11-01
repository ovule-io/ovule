import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import filesTokens from "@ovule/files/files.token";
import { expect, test } from "bun:test";
import { createRegistry, createScope } from "@ovule/ioc-container";
import { registerDesktopServices } from "../services";
import { registerMainServices } from "./services";

test("restoring a blank New Tab ignores stray URL metadata but retains explicitly opened directories", async () => {
  const saved = new Map([
    [
      "ovule.workbench.tabs",
      JSON.stringify({
        tabs: [
          {
            id: "blank",
            kind: "browser",
            title: "Downloads",
            url: "file:///Users/test/Downloads/",
            requestVersion: 0,
            canGoBack: true,
          },
          {
            id: "directory",
            kind: "browser",
            title: "Downloads",
            target: "file:///Users/test/Downloads/",
            url: "file:///Users/test/Downloads/",
            requestVersion: 1,
          },
        ],
        activeId: "blank",
      }),
    ],
  ]);
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  };
  const app = createScope(registerDesktopServices(createRegistry(), { storage }));
  const main = createScope(registerMainServices(createRegistry(), { storage }), app);
  try {
    const tabs = main.get(panesTokens.panes).current().instances;
    expect(tabs[0]).toMatchObject({ title: "New tab", requestVersion: 0, canGoBack: false });
    expect(tabs[0].url).toBeUndefined();
    expect(tabs[0].target).toBeUndefined();
    expect(tabs[1].url).toBe("file:///Users/test/Downloads/");
    expect(tabs[1].target).toBe("file:///Users/test/Downloads/");
  } finally {
    await app.dispose();
  }
});

test("moving a conversation pane to workbench preserves its instance and navigation", async () => {
  const app = createScope(registerDesktopServices(createRegistry()));
  let nextId = 0;
  const main = createScope(
    registerMainServices(createRegistry(), { createId: () => String(++nextId) }),
    app,
  );
  try {
    const panes = main.get(panesTokens.panes);
    const layout = main.get(frameworkTokens.frameworkLayout);
    const id = panes.openTab("browser", {
      placement: "thread",
      threadId: "thread",
      target: "https://example.com",
      autoLoad: true,
    });
    panes.updateTab(id, { title: "Example", url: "https://example.com/page", canGoBack: true });
    expect(layout.current().workbenchOpen).toBe(false);
    expect(panes.current().activeThreadArtifacts.thread).toBe(id);
    const before = panes.current().instances.find((pane) => pane.id === id)!;
    panes.moveTabToWorkbench(id);
    expect(panes.current().instances).toHaveLength(1);
    expect(panes.current().instances[0]).toEqual({ ...before, placement: "workbench" });
    expect(panes.current().activeThreadArtifacts.thread).toBeUndefined();
    expect(panes.current().activeWorkbenchPaneId).toBe(id);
    expect(layout.current().workbenchOpen).toBe(true);
    expect(panes.current()).not.toHaveProperty("sidebarWidth");
    expect(layout.current()).not.toHaveProperty("instances");
    expect(main.get(conversationTokens.selection)).toBe(app.get(conversationTokens.selection));
    expect(main.get(workspaceTokens.workspace)).toBe(app.get(workspaceTokens.workspace));
  } finally {
    await app.dispose();
  }
});

test("legacy panes and sidebar width persist while workbench starts at its fixed default", async () => {
  const saved = new Map<string, string>([
    [
      "ovule.workbench.tabs",
      JSON.stringify({
        tabs: [
          {
            id: "browser-existing",
            kind: "browser",
            title: "Saved",
            target: "https://example.com",
            requestVersion: 2,
            placement: "workbench",
          },
        ],
        activeId: "browser-existing",
      }),
    ],
    ["ovule.workbench.sidebarWidth", "250"],
    ["ovule.workbench.panelWidth", "520"],
  ]);
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const app = createScope(registerDesktopServices(createRegistry()));
  const main = createScope(registerMainServices(createRegistry(), { storage }), app);
  try {
    const panes = main.get(panesTokens.panes);
    const layout = main.get(frameworkTokens.frameworkLayout);
    expect(panes.current().activeWorkbenchPaneId).toBe("browser-existing");
    expect(panes.current().instances[0].requestVersion).toBe(2);
    expect(layout.current().sidebarWidth).toBe(250);
    expect(layout.current().workbenchWidth).toBe(360);
    layout.setWorkbenchWidth(600);
    panes.updateTab("browser-existing", { title: "Updated" });
    expect(layout.current().workbenchWidth).toBe(600);
    expect(saved.get("ovule.workbench.panelWidth")).toBe("520");
    expect(JSON.parse(saved.get("ovule.workbench.tabs")!).tabs[0].title).toBe("Updated");
  } finally {
    await app.dispose();
  }
});

import { registerPaneServices } from "../pane/services";

test("pane composition installs the grouped file capabilities with all other pane kinds", async () => {
  const app = createScope(registerDesktopServices(createRegistry()));
  const pane = createScope(registerPaneServices(createRegistry()), app);
  try {
    const registry = pane.get(panesTokens.paneRegistry);
    expect(
      registry
        .list()
        .map((definition) => definition.kind)
        .sort(),
    ).toEqual([
      "browser",
      "files",
      "handoff",
      "markdown",
      "office",
      "spice",
      "terminal",
      "workflow",
    ]);
    expect(registry.resolve("office")).toBe(pane.get(filesTokens.fileEditorPaneDefinition));
    expect(registry.resolve("files")).toBe(pane.get(filesTokens.localFilesPaneDefinition));
    expect(registry.resolve("markdown")).toBe(pane.get(filesTokens.markdownPaneDefinition));
  } finally {
    await app.dispose();
  }
});

test("draft tabs persist and bind to a new thread without replacing their instances", async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const app = createScope(registerDesktopServices(createRegistry()));
  let nextId = 0;
  const main = createScope(
    registerMainServices(createRegistry(), {
      storage,
      createId: () => String(++nextId),
    }),
    app,
  );
  try {
    const panes = main.get(panesTokens.panes);
    const draftId = panes.current().draftConversationId;
    const browser = panes.openTab("browser", {
      placement: "thread",
      threadId: "",
      draftId,
      target: "https://example.com",
      autoLoad: true,
    });
    panes.updateTab(browser, {
      title: "Draft page",
      url: "https://example.com/edit",
      canGoBack: true,
    });
    const terminal = panes.openTab("terminal", { placement: "thread", draftId });
    expect(main.get(frameworkTokens.frameworkLayout).current().workbenchOpen).toBe(false);
    expect(panes.current().activeThreadArtifacts[draftId]).toBe(terminal);
    const before = panes.current().instances;
    const restored = createScope(registerMainServices(createRegistry(), { storage }), app);
    expect(restored.get(panesTokens.panes).current().draftConversationId).toBe(draftId);
    expect(restored.get(panesTokens.panes).current().instances).toEqual(before);
    panes.bindDraftToThread(draftId, "created-thread");
    expect(panes.current().instances).toEqual(
      before.map((tab) => ({ ...tab, draftId: undefined, threadId: "created-thread" })),
    );
    expect(panes.current().activeThreadArtifacts[draftId]).toBeUndefined();
    expect(panes.current().activeThreadArtifacts["created-thread"]).toBe(terminal);
    const nextDraft = panes.current().draftConversationId;
    expect(nextDraft).not.toBe(draftId);
    const nextTab = panes.openTab("browser", { placement: "thread", draftId: nextDraft });
    panes.bindDraftToThread(draftId, "stale-thread");
    expect(panes.current().instances.find((tab) => tab.id === nextTab)?.draftId).toBe(nextDraft);
    panes.moveTabToWorkbench(browser);
    expect(panes.current().instances.find((tab) => tab.id === browser)).toEqual({
      ...before[0],
      placement: "workbench",
      draftId: undefined,
      threadId: "created-thread",
    });
    expect(JSON.parse(saved.get("ovule.workbench.tabs")!).draftConversationId).toBe(nextDraft);
  } finally {
    await app.dispose();
  }
});

test("tab visits persist across reloads without changing sidebar order", async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const app = createScope(registerDesktopServices(createRegistry()));
  const main = createScope(registerMainServices(createRegistry(), { storage }), app);
  try {
    const panes = main.get(panesTokens.panes);
    const a = panes.openTab("browser", {
      placement: "thread",
      threadId: "thread",
      newInstance: true,
    });
    const b = panes.openTab("browser", { newInstance: true });
    const c = panes.openTab("files", {
      placement: "thread",
      threadId: "thread",
      newInstance: true,
    });
    const opened = panes.current().instances.map((tab) => tab.id);
    panes.selectTab(a);
    const firstVisit = panes.current().instances.find((tab) => tab.id === a)!.lastVisited!;
    expect(firstVisit).toBeGreaterThan(
      panes.current().instances.find((tab) => tab.id === c)!.lastVisited!,
    );
    panes.selectTab(b);
    expect(panes.current().instances.find((tab) => tab.id === b)!.lastVisited!).toBeGreaterThan(
      firstVisit,
    );
    expect(panes.current().instances.map((tab) => tab.id)).toEqual(opened);
    const restored = createScope(registerMainServices(createRegistry(), { storage }), app).get(
      panesTokens.panes,
    );
    expect(restored.current().instances.map((tab) => tab.lastVisited)).toEqual(
      panes.current().instances.map((tab) => tab.lastVisited),
    );
    restored.selectThreadArtifact("thread", c);
    expect(restored.current().instances.find((tab) => tab.id === c)!.lastVisited!).toBeGreaterThan(
      panes.current().instances.find((tab) => tab.id === b)!.lastVisited!,
    );
  } finally {
    await app.dispose();
  }
});

test("main composition provides pane definitions and resolves the toolbar dependency graph", async () => {
  const app = createScope(registerDesktopServices(createRegistry()));
  const main = createScope(registerMainServices(createRegistry()), app);
  try {
    const registry = main.get(panesTokens.paneRegistry);
    expect(registry.resolve("browser").workspaceToolbar).toBeTypeOf("function");
    expect(registry.list()).toHaveLength(8);
    expect(main.get(panesTokens.paneToolbarView)).toBeTypeOf("function");
    expect(registry.resolve("office")).toBe(main.get(filesTokens.fileEditorPaneDefinition));
  } finally {
    await main.dispose();
    await app.dispose();
  }
});

test("live pane toolbar state survives promotion but is not restored from storage", async () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const app = createScope(registerDesktopServices(createRegistry()));
  const main = createScope(registerMainServices(createRegistry(), { storage }), app);
  try {
    const panes = main.get(panesTokens.panes);
    const id = panes.openTab("spice", { placement: "thread", threadId: "thread" });
    const toolbarState = { status: "connected", mode: "relay", quality: "detail" };
    panes.updateTab(id, { toolbarState });
    panes.moveTabToWorkbench(id);
    expect(panes.current().instances.find((tab) => tab.id === id)?.toolbarState).toEqual(
      toolbarState,
    );
    expect(JSON.parse(saved.get("ovule.workbench.tabs")!).tabs[0]).not.toHaveProperty(
      "toolbarState",
    );
    const restored = createScope(registerMainServices(createRegistry(), { storage }), app);
    try {
      expect(restored.get(panesTokens.panes).current().instances[0].toolbarState).toBeUndefined();
    } finally {
      await restored.dispose();
    }
  } finally {
    await main.dispose();
    await app.dispose();
  }
});
