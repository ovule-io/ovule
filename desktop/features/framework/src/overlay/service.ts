import type {
  ExplorerOverlayRequest,
  LiveExplorerRequest,
  MainOverlayState,
  MainOverlayService,
} from "./main-overlay";

export function createMainOverlayService(): MainOverlayService {
  let nextExplorerId = 0;
  let state: MainOverlayState = {
    explorerTabs: {},
    settingsOpen: false,
    remoteWorkspacesOpen: false,
    onboardingRequested: false,
    threadSwitcherOpen: false,
  };
  const listeners = new Set<() => void>();
  const update = (next: Partial<MainOverlayState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  const keyFor = (
    target: "settings" | "remoteWorkspaces" | "onboarding" | "threadSwitcher",
  ): keyof MainOverlayState =>
    target === "settings"
      ? "settingsOpen"
      : target === "remoteWorkspaces"
        ? "remoteWorkspacesOpen"
        : target === "onboarding"
          ? "onboardingRequested"
          : "threadSwitcherOpen";
  return {
    openExplorer(request) {
      if (!/^(?:https?|file):\/\//i.test(request.target)) return;
      if (
        state.explorer?.target === request.target &&
        state.explorer.threadId === request.threadId &&
        state.explorer.agent === request.agent
      )
        return;
      update({
        explorer: { ...request, id: `explorer-preview-${++nextExplorerId}` },
      });
    },
    closeExplorer() {
      update({ explorer: undefined });
    },
    promoteExplorer(tabId) {
      if (!state.explorer) return;
      update({
        explorerTabs: { ...state.explorerTabs, [tabId]: state.explorer },
      });
    },
    releaseExplorerTab(tabId) {
      if (!state.explorerTabs[tabId]) return;
      const explorerTabs = { ...state.explorerTabs };
      delete explorerTabs[tabId];
      update({ explorerTabs });
    },
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open(target) {
      if (target === "settings") {
        update({ settingsOpen: true, remoteWorkspacesOpen: false });
      } else if (target === "remoteWorkspaces") {
        update({ settingsOpen: false, remoteWorkspacesOpen: true });
      } else {
        update({ [keyFor(target)]: true });
      }
    },
    close(target) {
      update({ [keyFor(target)]: false });
    },
  };
}
