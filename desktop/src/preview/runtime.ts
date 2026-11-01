import type { MountIsolated, IsolatedView } from "@ovule/shell/isolated";

/** A preview owns one view and realm; it needs no application service registry. */
export const mountIsolated: MountIsolated = async (
  container,
  extensionId,
  tag,
  properties,
  onRequest,
) => {
  type World = {
    mount(
      host: HTMLElement,
      options: {
        tag: string;
        properties: Record<string, unknown>;
        onRequest?: Parameters<MountIsolated>[4];
      },
    ): Promise<IsolatedView>;
    dispose(): Promise<void>;
  };
  const api = (
    globalThis as typeof globalThis & {
      tuffite?: { isolated?: { createWorld(options: { name: string }): Promise<World> } };
    }
  ).tuffite?.isolated;
  if (!api) throw new Error("Isolated Office preview is unavailable");
  const world = await api.createWorld({ name: extensionId });
  try {
    const view = await world.mount(container, { tag, properties, onRequest });
    let disposed = false;
    return {
      update: (properties) => view.update(properties),
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await view.dispose();
        } finally {
          await world.dispose();
        }
      },
    };
  } catch (error) {
    await world.dispose();
    throw error;
  }
};
