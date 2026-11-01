import type { ExplorerElement } from "./explorer";
import { localExplorerSource, localExplorerAddress, htmlPreviewRequest } from "./local-files";
import { isNative } from "./native";

type PreviewGrant = { id: string; kind: string; url: string };
type PreviewApi = {
  createFilePreview(url: string): Promise<PreviewGrant>;
  createHtmlPreview(threadId: string, path: string): Promise<PreviewGrant>;
  revokePreview(id: string): Promise<boolean>;
};

/** Only the trusted host mints grants. A newer navigation supersedes pending work. */
export function createExplorerLoader(api: () => Promise<PreviewApi>, native = true) {
  const requests = new WeakMap<ExplorerElement, object>();
  const grants = new WeakMap<ExplorerElement, string>();
  const retained = new WeakMap<ExplorerElement, Set<string>>();
  const revoke = (id: string) =>
    void api()
      .then((api) => api.revokePreview(id))
      .catch(console.error);
  const load = (element: ExplorerElement, address: string, initial = false): void => {
    address = localExplorerAddress(address);
    const request = {};
    requests.set(element, request);
    element.dataset.previewPending = "false";
    // History entries still need their file-bound grants when Chromium goes back.
    let created: string | undefined;
    const html = htmlPreviewRequest(address);
    const mapped = localExplorerSource(address);
    const failed = (error: unknown) => {
      if (requests.get(element) !== request || !element.isConnected) return;
      element.dataset.previewPending = "false";
      if (created) {
        retained.get(element)?.delete(created);
        if (grants.get(element) === created) grants.delete(element);
        revoke(created);
      }
      element.dispatchEvent(
        new CustomEvent("loaderror", {
          detail: { message: error instanceof Error ? error.message : String(error) },
        }),
      );
    };
    const commit = (source: string) => {
      element.dataset.previewPending = "false";
      try {
        if (initial) element.src = source;
        else element.load(source);
      } catch (error) {
        failed(error);
      }
    };
    if ((!html && mapped === address) || !native) {
      commit(mapped);
      return;
    }
    element.dataset.previewPending = "true";
    void api()
      .then((api) =>
        html ? api.createHtmlPreview(html.threadId, html.path) : api.createFilePreview(address),
      )
      .then((grant) => {
        if (requests.get(element) !== request || !element.isConnected) {
          revoke(grant.id);
          return;
        }
        created = grant.id;
        grants.set(element, grant.id);
        const owned = retained.get(element) ?? new Set<string>();
        owned.add(grant.id);
        retained.set(element, owned);
        const source = new URL(`ovule://${grant.id}.local/${grant.kind}`);
        // Display metadata only: guest reads always use the opaque grant, never this URL.
        source.searchParams.set("url", html ? address : grant.url);
        source.searchParams.set("theme", document.documentElement.dataset.theme ?? "light");
        source.searchParams.set("language", document.documentElement.lang || "en");
        const bounds = element.getBoundingClientRect();
        source.searchParams.set("width", String(bounds.width));
        source.searchParams.set("height", String(bounds.height));
        commit(source.href);
      })
      .catch(failed);
  };
  const observe = (element: ExplorerElement) => {
    if (!native) return () => {};
    let transferred = false;
    let current: string | undefined;
    let disposed = false;
    const remember = (address: string) => {
      try {
        current = new URL(address).hostname.match(/^([a-f0-9]{48})\.local$/)?.[1];
      } catch {
        current = undefined;
      }
    };
    const sync = () => {
      if (typeof element.getNavigationState === "function")
        void element
          .getNavigationState()
          .then((state) => {
            if (!disposed) remember(state.url);
          })
          .catch(() => {});
    };
    const viewport = () => {
      if (!current && !grants.get(element)) return;
      const bounds = element.getBoundingClientRect();
      element.postMessage?.({
        type: "preview.viewport",
        width: bounds.width,
        height: bounds.height,
      });
    };
    const resize = new ResizeObserver(viewport);
    resize.observe(element);
    element.addEventListener("loadstop", viewport);
    const detached = () => {
      transferred = true;
    };
    remember(element.src);
    element.addEventListener("attached", sync);
    element.addEventListener("loadcommit", sync);
    element.addEventListener("detached", detached);
    return () => {
      disposed = true;
      requests.delete(element);
      resize.disconnect();
      element.removeEventListener("loadstop", viewport);
      element.removeEventListener("attached", sync);
      element.removeEventListener("loadcommit", sync);
      element.removeEventListener("detached", detached);
      const owned = retained.get(element) ?? new Set<string>();
      const id = grants.get(element) ?? current;
      if (id) owned.add(id);
      retained.delete(element);
      grants.delete(element);
      // A transferred native guest keeps its navigation history and grants alive.
      if (!transferred) for (const id of owned) revoke(id);
    };
  };
  return Object.assign(load, { observe });
}

export const loadExplorer = createExplorerLoader(
  async () => (await import("@ovule/shell-api")).browser,
  isNative,
);
