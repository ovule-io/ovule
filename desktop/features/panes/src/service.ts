import { createStore } from "zustand/vanilla";

import type { TerminalStateService } from "@ovule/terminal/state";
import type { OpenPaneOptions, PanesService, PanesState } from "@ovule/panes/panes";
import type { FrameworkLayoutService } from "@ovule/framework/framework";
import type { PaneInstance, PaneKind } from "@ovule/panes/tab";

type PanesStoreState = PanesState & {
  selectThreadArtifact(threadId: string, id?: string): void;
  moveTabToWorkbench(id: string): void;
  updateTab(
    id: string,
    values: Partial<
      Pick<
        PaneInstance,
        | "title"
        | "url"
        | "favicon"
        | "target"
        | "requestVersion"
        | "canGoBack"
        | "canGoForward"
        | "toolbarState"
      >
    >,
  ): void;
  instances: PaneInstance[];
  activeWorkbenchPaneId?: string;
  nextTerminalOrdinal: number;
  nextBrowserOrdinal: number;
  openTab(kind: PaneKind, options?: OpenPaneOptions): string;
  selectTab(id: string): void;
  closeTab(id: string): void;
};

export type PanesStorage = Pick<Storage, "getItem" | "setItem">;

export type PanesDependencies = {
  terminal: TerminalStateService;
  layout: FrameworkLayoutService;
  storage?: PanesStorage;
  createId?: () => string;
};

export function createPanesService({
  terminal,
  layout,
  storage,
  createId = () => crypto.randomUUID(),
}: PanesDependencies): PanesService {
  const persisted = loadPanesState(storage);
  let visitSequence = persisted.tabs.reduce(
    (latest, tab) => Math.max(latest, Number.isSafeInteger(tab.lastVisited) ? tab.lastVisited! : 0),
    0,
  );
  const visit = (tabs: PaneInstance[], id?: string) => {
    if (!id || !tabs.some((tab) => tab.id === id)) return tabs;
    const order = ++visitSequence;
    return tabs.map((tab) => (tab.id === id ? { ...tab, lastVisited: order } : tab));
  };
  const store = createStore<PanesStoreState>((set, get) => ({
    draftConversationId: persisted.draftConversationId,
    activeThreadArtifacts: {},
    selectThreadArtifact: (threadId, id) =>
      set((state) => ({
        instances: visit(state.instances, id),
        activeThreadArtifacts: {
          ...state.activeThreadArtifacts,
          [threadId]: id,
        },
      })),
    moveTabToWorkbench: (id) => {
      layout.openWorkbench();
      set((state) => ({
        activeWorkbenchPaneId: id,
        instances: state.instances.map((tab) =>
          tab.id === id ? { ...tab, placement: "workbench" } : tab,
        ),
        activeThreadArtifacts: Object.fromEntries(
          Object.entries(state.activeThreadArtifacts).map(([thread, active]) => [
            thread,
            active === id ? undefined : active,
          ]),
        ),
      }));
    },
    updateTab: (id, values) =>
      set((state) => ({
        instances: state.instances.map((tab) => (tab.id === id ? { ...tab, ...values } : tab)),
      })),
    instances: persisted.tabs,
    activeWorkbenchPaneId: persisted.activeId,
    nextTerminalOrdinal: persisted.nextTerminalOrdinal,
    nextBrowserOrdinal: persisted.nextBrowserOrdinal,
    openTab: (kind, options = {}) => {
      const state = get();
      const placement = options.placement ?? "workbench";
      const ownerId = options.threadId || options.draftId;
      if (kind === "browser" && options.target && /^ovule:/i.test(options.target)) {
        return (
          (placement === "thread" && ownerId
            ? state.activeThreadArtifacts[ownerId]
            : state.activeWorkbenchPaneId) ??
          state.instances.find((tab) => tab.kind === "browser")?.id ??
          ""
        );
      }
      const visited = ++visitSequence;
      const activation = (id: string) => {
        if (placement !== "thread" || !ownerId) layout.openWorkbench();
        return placement === "thread" && ownerId
          ? {
              activeThreadArtifacts: {
                ...state.activeThreadArtifacts,
                [ownerId]: id,
              },
            }
          : { activeWorkbenchPaneId: id };
      };
      if (
        placement === "thread" &&
        ownerId &&
        options.target &&
        !options.replaceBlankId &&
        options.reuseExistingTarget !== false
      ) {
        const existing = state.instances.find(
          (tab) =>
            tab.placement === "thread" &&
            (tab.threadId ?? tab.draftId) === ownerId &&
            tab.kind === kind &&
            tab.target === options.target,
        );
        if (existing) {
          set({ ...activation(existing.id), instances: visit(state.instances, existing.id) });
          return existing.id;
        }
      }
      const reusable =
        !options.newInstance && !isMultiInstanceKind(kind)
          ? state.instances.find(
              (tab) =>
                tab.kind === kind &&
                (tab.placement ?? "workbench") === placement &&
                (tab.threadId ?? tab.draftId) === ownerId,
            )
          : undefined;
      if (reusable) {
        const hasNavigationRequest = Boolean(options.autoLoad && options.target);
        set({
          ...activation(reusable.id),
          instances: state.instances.map((tab) =>
            tab.id === reusable.id
              ? {
                  ...tab,
                  lastVisited: visited,
                  target: options.target ?? tab.target,
                  navigation: options.navigation ?? tab.navigation,
                  autoLoad: hasNavigationRequest ? true : tab.autoLoad,
                  requestVersion: hasNavigationRequest
                    ? tab.requestVersion + 1
                    : tab.requestVersion,
                }
              : tab,
          ),
        });
        return reusable.id;
      }

      const ordinal =
        kind === "terminal"
          ? state.nextTerminalOrdinal
          : kind === "browser"
            ? state.nextBrowserOrdinal
            : undefined;
      const blank = state.instances.find(
        (tab) =>
          tab.id === options.replaceBlankId &&
          tab.kind === "browser" &&
          !tab.target &&
          !tab.url &&
          (tab.placement ?? "workbench") === placement &&
          (tab.threadId ?? tab.draftId) === ownerId,
      );
      const id = blank?.id ?? `${kind}-${createId()}`;
      const title =
        kind === "terminal"
          ? `Terminal ${ordinal}`
          : (
              {
                workflow: "Workflow",
                browser: "New tab",
                handoff: "Human handoff",
                spice: "Remote desktop",
                files: "Local files",
                markdown: "Markdown",
                office: "Office",
                terminal: "Terminal",
              } satisfies Record<PaneKind, string>
            )[kind];
      const pane: PaneInstance = {
        id,
        kind,
        lastVisited: visited,
        title:
          kind !== "handoff" && kind !== "spice" && options.target
            ? options.target.split(/[\\/]/).at(-1) || title
            : title,
        placement,
        ordinal,
        threadId: options.threadId || undefined,
        draftId: options.draftId,
        workspaceBindingId: options.workspaceBindingId,
        shellProfileId: options.shellProfileId,
        useThreadWorkspace: options.useThreadWorkspace,
        target: options.target,
        autoLoad: options.autoLoad,
        navigation: options.navigation,
        requestVersion: (blank?.requestVersion ?? 0) + (options.autoLoad && options.target ? 1 : 0),
      };
      set({
        ...activation(id),
        nextTerminalOrdinal:
          kind === "terminal" ? state.nextTerminalOrdinal + 1 : state.nextTerminalOrdinal,
        nextBrowserOrdinal:
          kind === "browser" ? state.nextBrowserOrdinal + 1 : state.nextBrowserOrdinal,
        instances: blank
          ? state.instances.map((tab) => (tab.id === id ? pane : tab))
          : [...state.instances, pane],
      });
      return id;
    },
    selectTab: (id) => {
      const tab = get().instances.find((tab) => tab.id === id);
      if (tab?.placement === "thread" && (tab.threadId ?? tab.draftId))
        get().selectThreadArtifact((tab.threadId ?? tab.draftId)!, id);
      else {
        layout.openWorkbench();
        set((state) => ({ activeWorkbenchPaneId: id, instances: visit(state.instances, id) }));
      }
    },
    closeTab: (id) =>
      set((state) => {
        if (
          terminal
            .current()
            .snapshot?.terminalRuns.some(
              (run) =>
                run.ownerId === id && ["queued", "running", "cancelling"].includes(run.status),
            )
        )
          return state;
        const index = state.instances.findIndex((tab) => tab.id === id);
        const instances = state.instances.filter((tab) => tab.id !== id);
        const instancesOnly = instances.filter((tab) => tab.placement !== "thread");
        const activeThreadArtifacts = Object.fromEntries(
          Object.entries(state.activeThreadArtifacts).map(([thread, active]) => [
            thread,
            active === id ? undefined : active,
          ]),
        );
        if (!instancesOnly.length) {
          layout.closeWorkbench();
          return {
            instances,
            activeThreadArtifacts,
            activeWorkbenchPaneId: undefined,
          };
        }
        const activeWorkbenchPaneId =
          state.activeWorkbenchPaneId === id
            ? instancesOnly[Math.min(Math.max(index, 0), instancesOnly.length - 1)].id
            : state.activeWorkbenchPaneId;
        return { instances, activeThreadArtifacts, activeWorkbenchPaneId };
      }),
  }));

  store.subscribe((state, previous) => {
    if (
      state.draftConversationId !== previous.draftConversationId ||
      state.instances !== previous.instances ||
      state.activeWorkbenchPaneId !== previous.activeWorkbenchPaneId ||
      state.nextTerminalOrdinal !== previous.nextTerminalOrdinal ||
      state.nextBrowserOrdinal !== previous.nextBrowserOrdinal
    ) {
      storage?.setItem(
        "ovule.workbench.tabs",
        JSON.stringify({
          draftConversationId: state.draftConversationId,
          tabs: state.instances.map((tab) => ({ ...tab, toolbarState: undefined })),
          activeId: state.activeWorkbenchPaneId,
          nextTerminalOrdinal: state.nextTerminalOrdinal,
          nextBrowserOrdinal: state.nextBrowserOrdinal,
        }),
      );
    }
  });
  const panes: PanesService = {
    bindDraftToThread: (draftId, threadId) => {
      const state = store.getState();
      if (draftId !== state.draftConversationId || !threadId) return;
      const { [draftId]: active, ...others } = state.activeThreadArtifacts;
      store.setState({
        draftConversationId: `draft-${crypto.randomUUID()}`,
        instances: state.instances.map((tab) =>
          tab.draftId === draftId ? { ...tab, draftId: undefined, threadId } : tab,
        ),
        activeThreadArtifacts: { ...others, ...(active ? { [threadId]: active } : {}) },
      });
    },
    current: store.getState,
    subscribe: (listener) => store.subscribe(listener),
    selectThreadArtifact: (threadId, id) => store.getState().selectThreadArtifact(threadId, id),
    moveTabToWorkbench: (id) => store.getState().moveTabToWorkbench(id),
    updateTab: (id, values) => store.getState().updateTab(id, values),
    openTab: (kind, options) => store.getState().openTab(kind, options),
    selectTab: (id) => store.getState().selectTab(id),
    closeTab: (id) => store.getState().closeTab(id),
  };
  return panes;
}

function loadPanesState(storage?: PanesStorage): {
  draftConversationId: string;
  tabs: PaneInstance[];
  activeId?: string;
  nextTerminalOrdinal: number;
  nextBrowserOrdinal: number;
} {
  try {
    const persisted = storage?.getItem("ovule.workbench.tabs");
    const value = JSON.parse(persisted ?? "null") as {
      draftConversationId?: string;
      tabs?: PaneInstance[];
      activeId?: string;
      nextTerminalOrdinal?: number;
      nextBrowserOrdinal?: number;
    } | null;
    const rawTabs = Array.isArray(value?.tabs)
      ? value.tabs.filter(
          (tab) =>
            typeof tab.id === "string" &&
            [
              "workflow",
              "browser",
              "files",
              "markdown",
              "office",
              "terminal",
              "handoff",
              "spice",
            ].includes(tab.kind),
        )
      : [];
    const usedOrdinals = {
      browser: new Set<number>(),
      terminal: new Set<number>(),
    };
    const nextAvailableOrdinal = { browser: 1, terminal: 1 };
    const tabs = rawTabs.map((persistedTab) => {
      const tab = {
        ...persistedTab,
        toolbarState: undefined,
        placement:
          (persistedTab as unknown as { placement?: string }).placement === "aside"
            ? "workbench"
            : persistedTab.placement,
      } as PaneInstance;
      // A blank New Tab has never requested navigation. Stray surface metadata
      // must not turn it into a direct browser page when restoring a session.
      if (tab.kind === "browser" && !tab.target && tab.requestVersion === 0) {
        return {
          ...tab,
          title: "New tab",
          url: undefined,
          favicon: undefined,
          canGoBack: false,
          canGoForward: false,
        };
      }
      if (tab.kind === "browser" && tab.target === "dist/index.html") {
        return {
          ...tab,
          target: undefined,
          autoLoad: false,
          requestVersion: 0,
        };
      }
      if (tab.kind !== "browser" && tab.kind !== "terminal") return tab;
      const kind = tab.kind;
      while (usedOrdinals[kind].has(nextAvailableOrdinal[kind])) {
        nextAvailableOrdinal[kind] += 1;
      }
      const candidate =
        Number.isSafeInteger(tab.ordinal) &&
        (tab.ordinal ?? 0) > 0 &&
        !usedOrdinals[kind].has(tab.ordinal!)
          ? tab.ordinal!
          : nextAvailableOrdinal[kind];
      usedOrdinals[kind].add(candidate);
      nextAvailableOrdinal[kind] = Math.max(nextAvailableOrdinal[kind], candidate + 1);
      return { ...tab, ordinal: candidate };
    });
    const highestTerminal = tabs.reduce(
      (highest, tab) => Math.max(highest, tab.kind === "terminal" ? (tab.ordinal ?? 1) : 0),
      0,
    );
    const highestBrowser = tabs.reduce(
      (highest, tab) => Math.max(highest, tab.kind === "browser" ? (tab.ordinal ?? 1) : 0),
      0,
    );
    return {
      draftConversationId: value?.draftConversationId || `draft-${crypto.randomUUID()}`,
      tabs,
      activeId: tabs.some((tab) => tab.id === value?.activeId) ? value?.activeId : tabs.at(-1)?.id,
      nextTerminalOrdinal: Math.max(highestTerminal + 1, value?.nextTerminalOrdinal ?? 1),
      nextBrowserOrdinal: Math.max(highestBrowser + 1, value?.nextBrowserOrdinal ?? 1),
    };
  } catch {
    return {
      draftConversationId: `draft-${crypto.randomUUID()}`,
      tabs: [],
      nextTerminalOrdinal: 1,
      nextBrowserOrdinal: 1,
    };
  }
}

function isMultiInstanceKind(
  kind: PaneKind,
): kind is Extract<PaneKind, "browser" | "files" | "office" | "terminal" | "handoff" | "spice"> {
  return (
    kind === "browser" ||
    kind === "files" ||
    kind === "office" ||
    kind === "terminal" ||
    kind === "handoff" ||
    kind === "spice"
  );
}
