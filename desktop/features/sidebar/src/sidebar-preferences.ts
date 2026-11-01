import { create } from "@ovule/ioc";
import { createObservable } from "@ovule/ioc/observable";

export function createSidebarPreferences(storage?: Pick<Storage, "getItem" | "setItem">) {
  const key = "ovule.sidebar.archivedThreads";
  let initial: string[] = [];
  try {
    const saved: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
    if (Array.isArray(saved)) initial = saved.filter((id): id is string => typeof id === "string");
  } catch {
    /* Ignore corrupt preferences. */
  }
  const observable = createObservable({ archived: initial });
  return {
    ...observable.service,
    setArchived(id: string, archived: boolean) {
      const next = [
        ...new Set([
          ...observable.service.current().archived.filter((value) => value !== id),
          ...(archived ? [id] : []),
        ]),
      ];
      // Archive is a reversible sidebar preference; conversation history stays intact.
      storage?.setItem(key, JSON.stringify(next));
      observable.patch({ archived: next });
      observable.notify();
    },
  };
}
export const SidebarPreferencesFactory = create(
  () => createSidebarPreferences(typeof localStorage === "undefined" ? undefined : localStorage),
  "SidebarPreferences",
);
