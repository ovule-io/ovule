import type { PaneDefinition, PaneRegistry } from "./pane";

export function createPaneRegistry(fallbackKind = "browser"): PaneRegistry {
  const definitions = new Map<string, PaneDefinition>();
  return {
    register(definition) {
      definitions.set(definition.kind, definition);
      return () => {
        if (definitions.get(definition.kind) === definition) definitions.delete(definition.kind);
      };
    },
    resolve(kind) {
      const definition = definitions.get(kind ?? fallbackKind) ?? definitions.get(fallbackKind);
      if (!definition) throw new Error(`No pane registered for ${kind ?? fallbackKind}`);
      return definition;
    },
    list: () => [...definitions.values()],
  };
}
