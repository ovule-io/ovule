import type { HostsViewState, HostsViewStateService } from "./hosts";

export function createHostsViewState(): HostsViewStateService {
  let state: HostsViewState = {};
  const listeners = new Set<() => void>();
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch(value) {
      state = { ...state, ...value };
      listeners.forEach((listener) => listener());
    },
  };
}
