import type {
  DependsOn,
  Factory,
  ServiceFactory,
  ServiceKey,
} from "@ovule/ioc";
export const INTERNAL_SUSPENSE_READ: unique symbol = Symbol("suspenseRead");
type Key = ServiceKey<unknown>;
const label = (key: Key) =>
  typeof key === "symbol" ? (key.description ?? "Service") : key.name;

export interface Registry {
  register<T>(key: ServiceFactory<T>): Registry;
  register<T>(key: ServiceKey<T>, factory: Factory<T>): Registry;
  /** Freeze configuration and return a detached provider snapshot. */
  snapshot(): ReadonlyMap<Key, Factory<unknown>>;
}
export function createRegistry(): Registry {
  const providers = new Map<Key, Factory<unknown>>();
  let frozen = false;
  const registry: Registry = {
    register<T>(key: ServiceKey<T>, factory?: Factory<T>) {
      if (frozen)
        throw new Error(
          "Registry is frozen; configure a new registry before creating a scope",
        );
      const provider =
        factory ?? (typeof key !== "symbol" ? key.factory : undefined);
      if (!provider) throw new Error(`No factory supplied for ${label(key)}`);
      providers.set(key, provider as Factory<unknown>);
      return registry;
    },
    snapshot() {
      frozen = true;
      return new Map(providers);
    },
  };
  return registry;
}
type Entry = {
  state: "building" | "pending" | "fulfilled" | "rejected";
  value?: unknown;
  error?: unknown;
  promise?: Promise<unknown>;
  cleanups: Array<() => void | Promise<void>>;
};
const HAS_PROVIDER: unique symbol = Symbol("hasProvider");
const ATTACH_CHILD: unique symbol = Symbol("attachChild");
export interface Scope {
  [HAS_PROVIDER](key: ServiceKey<unknown>): boolean;
  [ATTACH_CHILD](child: Scope): () => void;
  has<T>(key: ServiceKey<T>): boolean;
  get<T>(key: ServiceKey<T>): T;
  getAsync<T>(key: ServiceKey<T>): Promise<T>;
  getOptional<T>(key: ServiceKey<T>): T | undefined;
  [INTERNAL_SUSPENSE_READ]<T>(key: ServiceKey<T>): T;
  dispose(): Promise<void>;
}
export function createScope(registry: Registry, parent?: Scope): Scope {
  const providers = registry.snapshot();
  const children = new Set<WeakRef<Scope>>();
  let detach = () => {};
  const entries = new Map<Key, Entry>();
  const edges = new Map<Key, Set<Key>>();
  const completed: Entry[] = [];
  let closed = false;
  let disposal: Promise<void> | undefined;
  const owns = (key: Key) =>
    providers.has(key) ||
    (!parent?.[HAS_PROVIDER](key) && typeof key !== "symbol");
  const path = (
    from: Key,
    to: Key,
    seen = new Set<Key>(),
  ): Key[] | undefined => {
    if (from === to) return [from];
    if (seen.has(from)) return;
    seen.add(from);
    for (const next of edges.get(from) ?? []) {
      const rest = path(next, to, seen);
      if (rest) return [from, ...rest];
    }
  };
  const edge = (from: Key, to: Key) => {
    const cycle = path(to, from);
    if (cycle)
      throw new Error(
        `Circular dependency: ${[from, ...cycle].map(label).join(" -> ")}`,
      );
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from)!.add(to);
  };
  const cleanup = async (entry: Entry) => {
    const errors: unknown[] = [];
    for (const callback of entry.cleanups.splice(0).reverse()) {
      try {
        await callback();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Service cleanup failed");
  };
  const initialize = (key: Key): Entry => {
    if (closed) throw new Error("Scope is disposed");
    const existing = entries.get(key);
    if (existing) return existing;
    const factory =
      providers.get(key) ?? (typeof key !== "symbol" ? key.factory : undefined);
    if (!factory) throw new Error(`No provider registered for ${label(key)}`);
    const entry: Entry = { state: "building", cleanups: [] };
    entries.set(key, entry);
    const dependency = (target: Key) => {
      if (closed || (entry.state !== "building" && entry.state !== "pending"))
        throw new Error(
          `dependsOn is only valid during construction of ${label(key)}`,
        );
      edge(key, target);
    };
    const dependsOn: DependsOn = Object.assign(
      <T>(target: ServiceKey<T>): T => {
        dependency(target);
        return scope.get(target);
      },
      {
        optional: <T>(target: ServiceKey<T>): T | undefined => {
          dependency(target);
          return scope.getOptional(target);
        },
        async: <T>(target: ServiceKey<T>): Promise<T> => {
          try {
            dependency(target);
            return scope.getAsync(target);
          } catch (error) {
            return Promise.reject(error);
          }
        },
        onDispose(callback: () => void | Promise<void>) {
          if (
            closed ||
            (entry.state !== "building" && entry.state !== "pending")
          )
            throw new Error("Register cleanup during service construction");
          entry.cleanups.push(callback);
        },
      },
    );
    const succeed = (result: unknown) => {
      entry.value = result;
      entry.state = "fulfilled";
      completed.push(entry);
      return result;
    };
    try {
      const result = factory(dependsOn);
      if (
        result != null &&
        typeof (result as PromiseLike<unknown>).then === "function"
      ) {
        entry.state = "pending";
        entry.promise = Promise.resolve(result).then(
          succeed,
          (error: unknown) => {
            entry.state = "rejected";
            entry.error = error;
            completed.push(entry);
            throw error;
          },
        );
        void entry.promise.catch(() => undefined);
      } else succeed(result);
    } catch (error) {
      entry.state = "rejected";
      entry.error = error;
      completed.push(entry);
    }
    return entry;
  };
  const read = <T>(key: ServiceKey<T>, suspense: boolean): T => {
    if (closed) throw new Error("Scope is disposed");
    if (!owns(key) && parent?.has(key))
      return suspense ? parent[INTERNAL_SUSPENSE_READ](key) : parent.get(key);
    const entry = initialize(key);
    if (entry.state === "fulfilled") return entry.value as T;
    if (entry.state === "rejected") throw entry.error;
    if (entry.state === "building")
      throw new Error(`Circular dependency while constructing ${label(key)}`);
    if (suspense) throw entry.promise;
    throw new Error(`Provider for ${label(key)} is async; use getAsync()`);
  };
  const scope: Scope = {
    [HAS_PROVIDER](key) {
      return providers.has(key) || Boolean(parent?.[HAS_PROVIDER](key));
    },
    [ATTACH_CHILD](child) {
      if (closed) throw new Error("Scope is disposed");
      // Do not retain scopes from React renders that never commit.
      for (const reference of children)
        if (!reference.deref()) children.delete(reference);
      const reference = new WeakRef(child);
      children.add(reference);
      return () => {
        children.delete(reference);
      };
    },
    has(key) {
      return owns(key) || Boolean(parent?.has(key));
    },
    get(key) {
      return read(key, false);
    },
    getAsync<T>(key: ServiceKey<T>): Promise<T> {
      try {
        if (closed) throw new Error("Scope is disposed");
        if (!owns(key) && parent?.has(key)) return parent.getAsync(key);
        const entry = initialize(key);
        if (entry.state === "rejected") return Promise.reject(entry.error);
        if (entry.state === "building")
          throw new Error(
            `Circular dependency while constructing ${label(key)}`,
          );
        return (entry.promise ?? Promise.resolve(entry.value)) as Promise<T>;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getOptional(key) {
      return scope.has(key) ? scope.get(key) : undefined;
    },
    [INTERNAL_SUSPENSE_READ](key) {
      return read(key, true);
    },
    dispose() {
      if (disposal) return disposal;
      closed = true;
      disposal = (async () => {
        const childResults = await Promise.allSettled(
          [...children].flatMap((reference) => {
            const child = reference.deref();
            return child ? [child.dispose()] : [];
          }),
        );
        // Wait for pending factories so their late results and registered resources are cleaned.
        await Promise.allSettled(
          [...entries.values()].flatMap((e) => (e.promise ? [e.promise] : [])),
        );
        const order = [...completed].reverse();
        const errors: unknown[] = childResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        for (const entry of order) {
          try {
            await cleanup(entry);
          } catch (error) {
            errors.push(error);
          }
        }
        entries.clear();
        edges.clear();
        completed.length = 0;
        children.clear();
        detach();
        if (errors.length)
          throw new AggregateError(errors, "Scope cleanup failed");
      })();
      return disposal;
    },
  };
  if (parent) detach = parent[ATTACH_CHILD](scope);
  return scope;
}
