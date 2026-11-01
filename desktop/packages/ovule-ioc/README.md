# Web IoC

`@ovule/ioc` supplies stable identities, factory construction and read-only React
consumption. [@ovule/ioc-container](../ovule-ioc-container/README.md) owns
registries, scopes, caches and lifecycle. Business implementations remain ordinary
functions, Zustand stores, hooks and React components.

```tsx
import { create, createToken } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
const ExplorerToken = createToken<PanesService>("Explorer");
const SidebarFactory = create((dependsOn) => {
  const explorer = dependsOn(ExplorerToken);
  return function SidebarView() {
    return <SidebarContent explorer={explorer} />;
  };
});
export function Sidebar() {
  const View = useService(SidebarFactory);
  return <View />;
}
```

create(factory, name?) returns a frozen ServiceFactory<T> identity with a default
recipe; it does not construct an instance. Tokens have no default implementation.
ServiceOf<typeof Key> extracts the service type. No feature(), defineService,
defineHook/defineView or bindHook/bindView wrappers are required.

## Choosing the entry point

| Context                             | API                            | Responsibility                                 |
| ----------------------------------- | ------------------------------ | ---------------------------------------------- |
| Factory construction                | dependsOn(Key)                 | Declare and resolve concrete dependencies      |
| Application/test root outside React | scope.get(Key)                 | Resolve an instance in its owning scope        |
| React component/hook entry          | useService(Factory)            | Read the nearest scope's factory result        |
| Composition before scope creation   | registry.register(Key, recipe) | Select a default or replacement implementation |

Registry configures recipes and has no get method. Scope owns instances. Factories
must not capture scopes, use root lookups to bypass dependency declarations, or
retain dependsOn after construction. Callbacks retain the resolved concrete service.
Runtime checks reject expired construction capabilities.

Use dependsOn.optional(Key) for optional bindings and await dependsOn.async(Key)
for asynchronous dependencies. Roots use scope.getAsync and Suspense consumers use
useServiceAsync. useService does not subscribe to state: use Zustand selectors or
useObservableState. React hooks run inside returned hooks/components, never factories.

## Capability contracts

In the source-owning `features/*` workspace packages, declarations and token identities
belong to their subdomain. Package-internal implementations may cooperate directly;
cross-package consumers use exported declarations and tokens. Token-specific validation checks
a single `export default tokens({ ... })`, without named exports or re-exports;
other imports follow ordinary boundaries. TypeScript enforces token members and
preserves each service type. `tokens` freezes the group without creating new
identities; `createToken` creates each identity. `@ovule/ioc/observable` provides
generic observable writers and cached derived readers; business data ownership remains
inside domain services, and application composition controls coherent update batches.

Package `.provider.ts` modules default-export a registration function accepting
`Register` from this package. The callback only binds a token to its typed factory;
it has no scope or container access. Desktop composition supplies the callback:

```ts
registerConversation((token, factory) => registry.register(token, factory));
```

Providers may import private implementations in their own package. Business packages
cannot import providers; application composition selects providers before scope creation.
