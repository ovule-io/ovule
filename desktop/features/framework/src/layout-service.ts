import { createStore } from "zustand/vanilla";
import type { FrameworkLayoutService, FrameworkLayoutState } from "./framework";
import { WORKBENCH_DEFAULT_WIDTH } from "./workbench-window";
export type LayoutStorage = Pick<Storage, "getItem" | "setItem">;
export function createFrameworkLayoutService(
  storage?: LayoutStorage,
  transitionWorkbench?: (open: boolean, commit: () => void) => Promise<void>,
): FrameworkLayoutService {
  const store = createStore<FrameworkLayoutState>(() => ({
    sidebarOpen: true,
    workbenchOpen: false,
    workbenchExpanded: false,
    workbenchTransitioning: false,
    sidebarWidth: storedWidth(storage, "ovule.workbench.sidebarWidth", 220, 180, 360),
    workbenchWidth: WORKBENCH_DEFAULT_WIDTH,
  }));
  let requestedOpen = false;
  let transitioning = false;
  const setWorkbenchOpen = (open: boolean) => {
    requestedOpen = open;
    if (!transitionWorkbench) {
      store.setState({
        workbenchOpen: open,
        ...(open && !store.getState().workbenchOpen
          ? { workbenchWidth: WORKBENCH_DEFAULT_WIDTH }
          : {}),
        ...(!open ? { workbenchExpanded: false } : {}),
      });
      return;
    }
    if (transitioning || store.getState().workbenchOpen === open) return;
    transitioning = true;
    store.setState({ workbenchTransitioning: true });
    void (async () => {
      try {
        while (store.getState().workbenchOpen !== requestedOpen) {
          const next = requestedOpen;
          if (next) store.setState({ workbenchWidth: WORKBENCH_DEFAULT_WIDTH });
          await transitionWorkbench(next, () =>
            store.setState({ workbenchOpen: next, ...(!next ? { workbenchExpanded: false } : {}) }),
          );
        }
      } catch (error) {
        console.error("Unable to resize window for Workbench", error);
      } finally {
        transitioning = false;
        store.setState({ workbenchTransitioning: false });
      }
    })();
  };
  return {
    current: store.getState,
    subscribe: (listener) => store.subscribe(listener),
    setSidebarOpen: (sidebarOpen) => store.setState({ sidebarOpen }),
    toggleSidebar: () => store.setState((state) => ({ sidebarOpen: !state.sidebarOpen })),
    openWorkbench: () => setWorkbenchOpen(true),
    closeWorkbench: () => setWorkbenchOpen(false),
    toggleWorkbenchExpanded: () =>
      store.setState((state) => ({ workbenchExpanded: !state.workbenchExpanded })),
    setSidebarWidth: (value) => {
      const sidebarWidth = clampWidth(value, 180, 360);
      storage?.setItem("ovule.workbench.sidebarWidth", String(sidebarWidth));
      store.setState({ sidebarWidth });
    },
    setWorkbenchWidth: (value) => {
      const workbenchWidth = clampWidth(value, 320, Infinity);
      store.setState({ workbenchWidth });
    },
  };
}
function storedWidth(
  storage: LayoutStorage | undefined,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return clampWidth(Number(storage?.getItem(key)) || fallback, minimum, maximum);
}

function clampWidth(value: number, minimum: number, maximum: number): number {
  return Math.round(Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)));
}
