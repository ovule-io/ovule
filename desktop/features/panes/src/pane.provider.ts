import tokens from "./panes.token";
import { type Register, type DependsOn } from "@ovule/ioc";
import type { PaneDefinition } from "./pane";
import { createPaneRegistry } from "./registry";
export default function register(
  register: Register,
  options: { definitions: (dependsOn: DependsOn) => readonly PaneDefinition[] },
): void {
  register(tokens.paneRegistry, (dependsOn) => {
    const registry = createPaneRegistry();
    for (const definition of options.definitions(dependsOn)) registry.register(definition);
    return registry;
  });
}
