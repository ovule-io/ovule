import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import terminalTokens from "@ovule/terminal/terminal.token";
import panesTokens from "@ovule/panes/panes.token";
import { describe, expect, test } from "bun:test";
import { createRegistry, createScope } from "@ovule/ioc-container";
import { registerDesktopServices } from "./services";
import { DesktopStateFactory } from "./state";
import type { WorkspaceService } from "@ovule/workspace/workspace";

import { createDomainGraph } from "./snapshot-sync";
import { createCompositionFixture } from "../../tests/domain-graph";
import { registerMainServices } from "./main/services";
import type { DesktopState } from "./state";
import type { AppSnapshot } from "@ovule/shell-api";
import type { WorkspaceApi } from "@ovule/workspace/contract";

function snapshot(revision = 1n): AppSnapshot {
  return {
    revision,
    threads: [
      {
        id: "injected-thread",
        title: "Injected workspace",
        agent: "test",
        workspacePath: "D:\\test",
      },
    ],
    goals: [],
    attempts: [],
    messages: [],
    terminalRuns: [],
    capabilities: [],
    legacyDataIssues: [],
  } as AppSnapshot;
}

describe("desktop store factories", () => {
  test("snapshot synchronization uses injected workspace and selection services", async () => {
    const { selection, stores } = createCompositionFixture();
    let apiReads = 0;
    const graph = createDomainGraph(
      {
        async api() {
          apiReads += 1;
          return {} as WorkspaceApi;
        },
      },
      selection,
      stores,
    );

    expect(await graph.sync.invoke(async () => snapshot())).toBe(true);
    expect(apiReads).toBe(1);
    expect(graph.stores.conversation.service.current().snapshot?.revision).toBe(1n);
    expect(selection.current().selectedThreadId).toBe("injected-thread");
  });

  test("workbench uses injected terminal state, storage and id generation", () => {
    const values = new Map<string, string>();
    const runtime = {
      current: () => ({
        snapshot: snapshot(),
        busy: false,
        pending: 0,
      }),
      subscribe: () => () => undefined,
    } as DesktopState;
    const registry = registerMainServices(createRegistry(), {
      createId: () => "stable-id",
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
      },
    });
    registry.register(terminalTokens.terminalState, () => runtime);
    const scope = createScope(registry);
    const workbench = scope.get(panesTokens.panes);

    const id = workbench.openTab("browser", {
      target: "https://example.com",
    });
    expect(id).toBe("browser-stable-id");
    expect(workbench.current().activeWorkbenchPaneId).toBe(id);
    expect(values.get("ovule.workbench.tabs")).toContain(id);
  });

  test("two factory graphs do not share state", async () => {
    const createGraph = () => {
      const { selection, stores } = createCompositionFixture();
      const graph = createDomainGraph({ api: async () => ({}) as WorkspaceApi }, selection, stores);
      return { selection, graph };
    };
    const first = createGraph();
    const second = createGraph();

    first.selection.selectThread("first-only");
    first.graph.sync.acceptSnapshot(snapshot(2n));
    expect(first.graph.stores.conversation.service.current().snapshot?.revision).toBe(2n);
    expect(second.graph.stores.conversation.service.current().snapshot).toBeUndefined();
    expect(second.selection.current().selectedThreadId).toBeUndefined();
  });
});

test("registry composition resolves overrides lazily and isolates application state", async () => {
  let reads = 0;
  const workspace = {
    api: async () => {
      reads++;
      return {} as WorkspaceApi;
    },
  } as WorkspaceService;
  const registry = registerDesktopServices(createRegistry(), { workspace });
  const first = createScope(registry);
  const second = createScope(registry);
  expect(reads).toBe(0);
  expect(first.get(workspaceTokens.workspace)).toBe(workspace);
  const runtime = first.get(DesktopStateFactory);
  await runtime.invoke(async () => snapshot());
  expect(reads).toBe(1);
  expect(first.get(conversationTokens.selection).current().selectedThreadId).toBe(
    "injected-thread",
  );
  expect(second.get(DesktopStateFactory).current().snapshot).toBeUndefined();
  await Promise.all([first.dispose(), second.dispose()]);
});

// Resolve the real feature graph without rendering: factories may capture dependencies,
// but React hooks and native activity must remain inside returned components/effects.
test("route view factories consume route dependencies and share their token instance", async () => {
  const { registerMainServices } = await import("./main/services");
  const { default: frameworkViewTokens } = await import("@ovule/framework/framework.token");
  const { default: sidebarViewTokens } = await import("@ovule/sidebar/sidebar.token");
  const { default: browserTokens } = await import("@ovule/browser/browser.token");
  const root = createScope(registerDesktopServices(createRegistry()));
  const route = createScope(registerMainServices(createRegistry()), root);
  expect(typeof route.get(frameworkViewTokens.frameworkView)).toBe("function");
  expect(typeof route.get(sidebarViewTokens.sidebarView)).toBe("function");
  expect(route.get(sidebarViewTokens.sidebarView)).toBe(route.get(sidebarViewTokens.sidebarView));
  await route.get(browserTokens.links).open({ target: "https://platform.deepseek.com/" });
  expect(route.get(frameworkViewTokens.mainOverlay).current().explorer?.target).toBe(
    "https://platform.deepseek.com/",
  );
  await root.dispose();
});

test("auxiliary routes resolve lifecycle without a root link opener", async () => {
  const { registerThreadServices } = await import("./thread/services");
  const { registerPaneServices } = await import("./pane/services");
  const { useApplicationLifecycleFactory } = await import("./shared/useApplicationLifecycle");
  const root = createScope(registerDesktopServices(createRegistry()));
  for (const register of [registerThreadServices, registerPaneServices]) {
    const route = createScope(register(createRegistry()), root);
    expect(typeof route.get(useApplicationLifecycleFactory)).toBe("function");
    await route.dispose();
  }
  await root.dispose();
});
