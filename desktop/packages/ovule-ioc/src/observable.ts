/** Two-phase updates let composition publish a coherent batch across services. */
export function createObservable<State>(initial: State) {
  let state = initial;
  const listeners = new Set<() => void>();
  const service = {
    current: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    service,
    stage(next: State) {
      state = next;
    },
    patch(update: Partial<State>) {
      state = { ...state, ...update };
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}
export function projectServices<
  Sources extends readonly {
    current(): unknown;
    subscribe(listener: () => void): () => void;
  }[],
  State,
>(
  sources: Sources,
  project: (
    ...states: { [K in keyof Sources]: ReturnType<Sources[K]["current"]> }
  ) => State,
) {
  let values = sources.map((source) => source.current());
  let state = project(
    ...(values as { [K in keyof Sources]: ReturnType<Sources[K]["current"]> }),
  );
  return {
    current() {
      const next = sources.map((source) => source.current());
      if (next.some((value, index) => value !== values[index])) {
        values = next;
        state = project(
          ...(values as {
            [K in keyof Sources]: ReturnType<Sources[K]["current"]>;
          }),
        );
      }
      return state;
    },
    subscribe(listener: () => void) {
      const remove = sources.map((source) => source.subscribe(listener));
      return () => {
        for (const cleanup of remove) cleanup();
      };
    },
  };
}
