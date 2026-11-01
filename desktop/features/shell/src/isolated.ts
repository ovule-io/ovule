import type { MountIsolated, IsolatedView } from "./isolated-api";

type World = {
  mount(
    container: HTMLElement,
    options: {
      tag: string;
      properties: Record<string, unknown>;
      onRequest?: Parameters<MountIsolated>[4];
    },
  ): Promise<IsolatedView>;
  dispose(): Promise<void>;
};
type Entry = { world: Promise<World>; references: number };
const worlds = new Map<string, Entry>();

async function release(extensionId: string, entry: Entry) {
  if (--entry.references !== 0) return;
  if (worlds.get(extensionId) === entry) worlds.delete(extensionId);
  let world: World;
  try {
    world = await entry.world;
  } catch {
    return;
  }
  await world.dispose();
}

/** Share the extension realm; each mounted view owns its own request handlers and lifetime. */
export const mountIsolated: MountIsolated = async (
  container,
  extensionId,
  tag,
  properties,
  onRequest,
) => {
  const api = (
    globalThis as typeof globalThis & {
      tuffite?: { isolated?: { createWorld(options: { name: string }): Promise<World> } };
    }
  ).tuffite?.isolated;
  if (!api) throw new Error("This UI requires a Tuffite Framework with isolated-world support");
  let entry = worlds.get(extensionId);
  if (!entry) {
    entry = { world: api.createWorld({ name: extensionId }), references: 0 };
    worlds.set(extensionId, entry);
  }
  entry.references++;
  const owned = entry;
  // Shell DTOs have optional fields; only explicit JSON values cross realms.
  const json = (value: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  try {
    const world = await owned.world;
    const view = await world.mount(container, {
      tag,
      properties: json(properties),
      onRequest: onRequest
        ? async (request) => JSON.parse(JSON.stringify((await onRequest(request)) ?? null))
        : undefined,
    });
    let disposed = false;
    return {
      update: (value) => view.update(json(value)),
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          await view.dispose();
        } finally {
          await release(extensionId, owned);
        }
      },
    };
  } catch (error) {
    await release(extensionId, owned);
    throw error;
  }
};
