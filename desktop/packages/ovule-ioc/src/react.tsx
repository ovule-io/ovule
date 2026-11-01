import { useContext, useSyncExternalStore } from "react";
import type { ServiceKey } from "./index";
import { ReaderContext } from "./bridge";
function useReader() {
  const reader = useContext(ReaderContext);
  if (!reader) throw new Error("ScopeProvider is missing");
  return reader;
}
export function useService<T>(key: ServiceKey<T>): T {
  return useReader().read(key);
}
export function useServiceAsync<T>(key: ServiceKey<T>): T {
  return useReader().readAsync(key);
}
export function useOptionalService<T>(key: ServiceKey<T>): T | undefined {
  return useReader().readOptional(key);
}

type ObservableService<State> = {
  current(): State;
  subscribe(listener: () => void): () => void;
};

export function useServiceState<State, Selected>(
  token: ServiceKey<ObservableService<State>>,
  selector: (state: State) => Selected,
): Selected {
  const service = useService(token);
  return useObservableState(service, selector);
}

export function useObservableState<State, Selected>(
  service: ObservableService<State>,
  selector: (state: State) => Selected,
): Selected {
  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.current,
    service.current,
  );
  return selector(snapshot);
}
