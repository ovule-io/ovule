import { create, createToken } from "@ovule/ioc";
import { createRegistry, createScope } from "@ovule/ioc-container";
function checkTypes() {
  const NumberService = create(() => 1, "Number");
  const registry = createRegistry().register(NumberService);
  const Token = createToken<number>("NumberPort");
  registry.register(Token, () => 2);
  // @ts-expect-error a service override must match the service value type
  registry.register(NumberService, () => "wrong");
  // @ts-expect-error a contract override must match the contract value type
  registry.register(Token, () => "wrong");
  // @ts-expect-error a token requires an explicit provider
  registry.register(Token);
  const scope = createScope(registry);
  const result: number = scope.get(NumberService);
  const asyncResult: Promise<number> = scope.getAsync(Token);
  return { result, asyncResult };
}
void checkTypes;
