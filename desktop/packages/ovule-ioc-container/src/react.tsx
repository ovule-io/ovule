import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from "react";
import { ReaderContext, type Reader } from "@ovule/ioc/bridge";
import {
  createScope,
  INTERNAL_SUSPENSE_READ,
  type Registry,
  type Scope,
} from "./index";
const Context = createContext<Scope | undefined>(undefined);
export function ScopeProvider({
  registry,
  children,
  onDisposeError = console.error,
}: PropsWithChildren<{
  registry: Registry;
  onDisposeError?: (error: unknown) => void;
}>) {
  const parent = useContext(Context);
  const scope = useMemo(
    () => createScope(registry, parent),
    [registry, parent],
  );
  const reader = useMemo<Reader>(
    () => ({
      read: (key) => scope.get(key),
      readAsync: (key) => scope[INTERNAL_SUSPENSE_READ](key),
      readOptional: (key) => scope.getOptional(key),
    }),
    [scope],
  );
  const lease = useMemo(() => ({ count: 0 }), [scope]);
  useEffect(() => {
    lease.count++;
    return () => {
      lease.count--;
      queueMicrotask(() => {
        if (!lease.count) void scope.dispose().catch(onDisposeError);
      });
    };
  }, [scope, lease, onDisposeError]);
  return createElement(
    Context.Provider,
    { value: scope },
    createElement(ReaderContext.Provider, { value: reader }, children),
  );
}
export function useScope(): Scope {
  const scope = useContext(Context);
  if (!scope) throw new Error("ScopeProvider is missing");
  return scope;
}
