# Web IoC Container

Application composition owns registration, instance caching and lifecycle through
this package. It depends on @ovule/ioc. Business factories receive DependsOn;
capabilities cannot import this package or obtain a Scope/Registry.

```tsx
import { create, value } from "@ovule/ioc";
import { createRegistry, createScope } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
const Service = create(() => "default");
const registry = createRegistry().register(Service, value("override"));
const scope = createScope(registry);
console.log(scope.get(Service));
await scope.dispose();
// Provider creates and releases a separate React scope.
<ScopeProvider registry={createRegistry()}>{children}</ScopeProvider>;
```

## Ownership

Registry stores recipes. createScope freezes configuration into an independent
provider snapshot; one registry can create multiple independent local caches.
Bindings cannot change after activation. Values, pending Promises, successful results
and failures belong to the scope. Retrying construction requires a new scope;
refreshing business data belongs to the service's resource/store API.

Child bindings construct in the child; inherited explicit bindings resolve in the
parent. Unregistered default factories belong to the requesting scope and therefore
consume its overrides. Explicit register(Factory) fixes ownership at that scope;
child overrides never modify parent-owned service construction.

Child disposal does not dispose the parent. Parent disposal waits for children
first. External value(instance) bindings borrow ownership and have no automatic
dispose callback; register cleanup explicitly when transferring ownership.

## React and lifecycle

ScopeProvider accepts a stable registry and inherits the nearest parent scope. It
publishes a restricted Reader to the construction package's React context. Effect
cleanup delays release by one microtask to tolerate StrictMode effect replay.
Keep factory construction pure: subscriptions, background tasks and writes belong
to effects or explicit start/stop. Abandoned React renders cannot rely on effect
cleanup; asynchronous initial reads must tolerate repetition and have timeouts.

```ts
const Service = create(async (dependsOn) => {
  const backend = await dependsOn.async(Backend);
  const state = createLocalState(backend);
  dependsOn.onDispose(() => state.dispose());
  return state;
}, "Service");
```

Every factory awaits all its asynchronous dependencies. Cleanup runs in reverse
construction completion order, including failed factories; callbacks within one
factory also run in reverse registration order. Consumers release before dependencies.

scope.dispose is idempotent, immediately rejects new resolutions, awaits pending
construction, then attempts every cleanup. Errors aggregate into AggregateError.
Factories that never settle also prevent disposal from finishing; I/O must have
explicit cancellation/timeouts. Provider exposes onDisposeError for release errors.

useServiceAsync returns settled values or throws the shared pending Promise/cached
error to the nearest Suspense/Error Boundary. Provider adds no global Suspense.

## Resolution diagnostics

Dependencies are discovered during lazy construction, not predeclared for whole-graph
startup. No Kahn sorting is required. Newly discovered dependsOn edges are checked
for cycles to prevent synchronous reentry and concurrent async mutual waiting.
Diagnostics describe visited paths; they cannot validate unvisited recipes in advance.

IoC services, mutable data caches and contribution registries serve different roles.
Pane/message/suggestion registries are ordinary service objects; their register/remove
methods do not mutate IoC configuration.

```sh
bun run --cwd packages/ovule-ioc-container typecheck
bun run --cwd packages/ovule-ioc-container test
bun run --cwd desktop test:architecture
```
