import {
  create,
  type DependsOn,
  type ServiceOf,
  createToken,
  tokens,
} from "../src";
// @ts-expect-error ownership APIs do not exist in the construction package
import { createRegistry } from "../src";
// @ts-expect-error React ownership is container-only
import { useScope } from "../src/react";
const Port = createToken<number>("Port");
const Service = create((dependsOn) => {
  // @ts-expect-error construction capabilities cannot inspect a scope
  dependsOn.get(Port);
  return dependsOn(Port);
});
type Result = ServiceOf<typeof Service>;
const number: Result = 1;
void number;
function cannotRetainFullContainer(deps: DependsOn) {
  // @ts-expect-error no configuration mutation during construction
  deps.register(Port, () => 1);
}
void cannotRetainFullContainer;
void createRegistry;
void useScope;

const grouped = tokens({ port: Port });
const groupedService = create((dependsOn) => dependsOn(grouped.port));
const groupedNumber: ServiceOf<typeof groupedService> = 1;
void groupedNumber;
// @ts-expect-error token groups cannot expose service implementations
tokens({ implementation: () => 42 });
// @ts-expect-error token groups cannot expose unrelated values
tokens({ port: 42 });
// @ts-expect-error the group API is readonly
grouped.port = Port;
// @ts-expect-error individual token service types are preserved
const wrongServiceType: ServiceOf<typeof grouped.port> = "wrong";
void wrongServiceType;
