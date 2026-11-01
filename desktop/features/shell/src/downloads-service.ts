import type { ExplorerDownload, ExplorerElement } from "./explorer";
import type { DownloadRecord, DownloadsService, DownloadsState } from "./downloads";
import type { DownloadView } from "@ovule/shell-api";

type NativeDownloads = Pick<
  (typeof import("@ovule/shell-api"))["browser"],
  | "listDownloads"
  | "downloadDirectory"
  | "publishDownload"
  | "removeDownload"
  | "revealDownload"
  | "setDownloadDirectory"
>;
export function createDownloadsService(
  load: () => Promise<{ browser: NativeDownloads }> = () => import("@ovule/shell-api"),
): DownloadsService {
  let state: DownloadsState = { items: [], directory: "~/Downloads" };
  const listeners = new Set<() => void>();
  const owners = new Map<string, ExplorerElement>();
  const publishing = new Set<string>();
  const hidden = new Set<string>();
  let loading: Promise<void> | undefined;
  let observed = false;
  let channel: BroadcastChannel | undefined;
  const connect = () => {
    if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    try {
      channel = new BroadcastChannel("ovule-download-history");
    } catch {
      return;
    }
    channel.onmessage = (event) => {
      const value = event.data;
      if (value?.kind === "replay") {
        for (const item of state.items) channel?.postMessage({ kind: "item", item });
      } else if (
        value?.kind === "item" &&
        typeof value.item?.key === "string" &&
        typeof value.item?.filename === "string"
      ) {
        const item = value.item as DownloadRecord;
        if (hidden.has(item.key)) return;
        replace([
          ...state.items.filter(
            (row) => row.key !== item.key && (!item.savedId || row.savedId !== item.savedId),
          ),
          item,
        ]);
      } else if (value?.kind === "removed" && typeof value.key === "string") {
        hidden.add(value.key);
        replace(
          state.items.filter(
            (item) => item.key !== value.key && (!value.savedId || item.savedId !== value.savedId),
          ),
        );
      }
    };
    channel.postMessage({ kind: "replay" });
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const replace = (items: DownloadRecord[], directory = state.directory) => {
    state = { items: items.slice(-300), directory };
    notify();
  };
  const saved = (row: DownloadView, existing?: DownloadRecord): DownloadRecord => ({
    key: existing?.key ?? `file:${row.source}`,
    savedId: row.id,
    savedPath: row.path,
    path: row.source,
    id: existing?.id ?? -1,
    url: row.url,
    filename: row.filename,
    mimeType: existing?.mimeType ?? "",
    state: "complete",
    error: 0,
    navigation: existing?.navigation ?? false,
    receivedBytes: Number(row.bytes),
    totalBytes: Number(row.bytes),
    createdAt: Number(row.createdAt),
  });
  const refresh = () => {
    if (loading) return loading;
    loading = (async () => {
      const { browser } = await load();
      const [rows, directory] = await Promise.all([
        browser.listDownloads(),
        browser.downloadDirectory(),
      ]);
      const ids = new Set(rows.map((row) => row.id));
      const items = state.items.filter((item) => !item.savedId || ids.has(item.savedId));
      for (const row of rows) {
        const index = items.findIndex(
          (item) => item.savedId === row.id || item.path === row.source,
        );
        const item = saved(row, items[index]);
        if (hidden.has(item.key)) continue;
        if (index >= 0) items[index] = item;
        else items.push(item);
      }
      replace(items, directory);
    })().finally(() => {
      loading = undefined;
    });
    return loading;
  };
  const announce = () => {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("ovule.downloadHistoryRevision", `${Date.now()}-${Math.random()}`);
      } catch {
        /* The native store remains authoritative. */
      }
    }
  };
  return {
    current: () => state,
    subscribe(listener) {
      connect();
      listeners.add(listener);
      const changed = (event: StorageEvent) => {
        if (event.key === "ovule.downloadHistoryRevision") void refresh().catch(console.error);
      };
      // A single listener is owned by the lifetime of the application's shell service.
      if (!observed && typeof window !== "undefined") {
        observed = true;
        window.addEventListener("storage", changed);
      }
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    update(element, item) {
      connect();
      const key = item.path ? `file:${item.path}` : `url:${item.url}:${item.id}`;
      if (hidden.has(key)) return;
      owners.set(key, element);
      const index = state.items.findIndex(
        (row) => row.key === key || (row.id === item.id && owners.get(row.key) === element),
      );
      const previous = state.items[index];
      const record: DownloadRecord = {
        ...previous,
        ...item,
        key,
        createdAt: previous?.createdAt ?? Date.now(),
      };
      const items = state.items.filter((row) => row.key !== previous?.key);
      items.push(record);
      replace(items);
      if (item.state !== "in-progress" && !item.canResume) owners.delete(key);
      channel?.postMessage({ kind: "item", item: record });
      if (item.state !== "complete" || !item.path || record.savedId || publishing.has(key)) return;
      publishing.add(key);
      void load()
        .then((api) => api.browser.publishDownload(item.path, item.url))
        .then(async (row) => {
          if (row.removed || hidden.has(key)) {
            if (!row.removed) {
              const { browser } = await load();
              await browser.removeDownload(row.id);
              announce();
            }
            replace(state.items.filter((value) => value.key !== key));
            return;
          }
          replace(state.items.map((value) => (value.key === key ? saved(row, value) : value)));
          const published = state.items.find((value) => value.key === key);
          if (published) channel?.postMessage({ kind: "item", item: published });
          announce();
        })
        .catch((error) =>
          replace(
            state.items.map((value) =>
              value.key === key ? { ...value, saveError: String(error) } : value,
            ),
          ),
        )
        .finally(() => publishing.delete(key));
    },
    async reveal(key) {
      const item = state.items.find((value) => value.key === key);
      if (!item?.savedId) throw new Error("Download is not saved yet");
      const { browser } = await load();
      if (!(await browser.revealDownload(item.savedId)))
        throw new Error("Could not reveal the downloaded file");
    },
    async cancel(key) {
      const item = state.items.find((value) => value.key === key);
      const owner = owners.get(key);
      if (!item || !owner || !(await owner.cancelDownload(item.id)))
        throw new Error("Could not cancel this download");
    },
    async pause(key) {
      const item = state.items.find((value) => value.key === key);
      const owner = owners.get(key);
      if (!item || !owner?.pauseDownload || !(await owner.pauseDownload(item.id)))
        throw new Error("Could not pause this download");
    },
    async resume(key) {
      const item = state.items.find((value) => value.key === key);
      const owner = owners.get(key);
      if (!item || !owner?.resumeDownload || !(await owner.resumeDownload(item.id)))
        throw new Error("Could not resume this download");
    },
    async remove(key) {
      const item = state.items.find((value) => value.key === key);
      if (!item) return;
      if (item.state === "in-progress" || item.canResume) await this.cancel(key);
      if (item.savedId) {
        const { browser } = await load();
        await browser.removeDownload(item.savedId);
      }
      hidden.add(key);
      owners.delete(key);
      channel?.postMessage({ kind: "removed", key, savedId: item.savedId });
      replace(state.items.filter((value) => value.key !== key));
      announce();
    },
    async setDirectory(path) {
      const { browser } = await load();
      const directory = await browser.setDownloadDirectory(path);
      replace(state.items, directory);
      announce();
    },
  };
}

export const downloadHistory = createDownloadsService();
