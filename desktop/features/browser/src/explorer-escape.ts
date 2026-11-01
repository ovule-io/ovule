import type { ExplorerElement, ExplorerNavigationState } from "@ovule/shell/explorer";

/** Guest WebContents do not bubble keys into the overlay document. */
export function installExplorerEscape(element: ExplorerElement, close: () => void, pollMs = 80) {
  const key = JSON.stringify(`ovule.escape.${crypto.randomUUID()}`);
  let disposed = false;
  let generation = 0;
  let paused = false;
  let installedDocument: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const install = (event: Event) => {
    const documentId = (event as CustomEvent<ExplorerNavigationState>).detail?.documentId;
    if (disposed || paused || !documentId || typeof element.executeJavaScript !== "function")
      return;
    if (installedDocument === documentId) return;
    installedDocument = documentId;
    clearTimeout(timer);
    const current = ++generation;
    const options = { world: "isolated" as const, expectedDocumentId: documentId };
    const active = () => !disposed && !paused && current === generation;
    // The SDK serializes immediate JSON values; it does not await guest Promises.
    // Keep a private flag in its isolated world and read only while the overlay
    // is alive. There is at most one native request in flight and no page bridge.
    const poll = () => {
      if (!active()) return;
      void element
        .executeJavaScript(`globalThis[${key}]?.escaped === true`, options)
        .then((escaped) => {
          if (!active()) return;
          if (escaped === true) close();
          else timer = setTimeout(poll, pollMs);
        })
        .catch(() => {
          // A new document's loadcommit installs its own listener.
        });
    };
    void element
      .executeJavaScript(
        `(() => {
      globalThis[${key}]?.remove();
      const state = { escaped: false };
      const onKey = event => {
        if (event.key === "Escape" && !event.isComposing) {
          event.preventDefault();
          event.stopImmediatePropagation();
          state.escaped = true;
        }
      };
      state.remove = () => {
        document.removeEventListener("keydown", onKey, true);
        delete globalThis[${key}];
      };
      globalThis[${key}] = state;
      document.addEventListener("keydown", onKey, true);
      return true;
    })()`,
        options,
      )
      .then(() => {
        if (active()) timer = setTimeout(poll, pollMs);
      })
      .catch(() => {
        if (active()) installedDocument = undefined;
      });
  };
  const refresh = () => {
    if (disposed || paused || typeof element.getNavigationState !== "function") return;
    void element
      .getNavigationState()
      .then((state) => {
        install(new CustomEvent("loadcommit", { detail: state }));
      })
      .catch(() => {});
  };
  element.addEventListener("loadcommit", install);
  element.addEventListener("loadstop", install);
  element.addEventListener("attached", refresh);
  queueMicrotask(refresh);
  const pause = async () => {
    paused = true;
    installedDocument = undefined;
    generation++;
    clearTimeout(timer);
    if (typeof element.executeJavaScript === "function")
      await element
        .executeJavaScript(`globalThis[${key}]?.remove(); true`, { world: "isolated" })
        .catch(() => {});
  };
  const resume = () => {
    if (disposed) return;
    paused = false;
    refresh();
  };
  return Object.assign(
    () => {
      disposed = true;
      element.removeEventListener("loadcommit", install);
      element.removeEventListener("loadstop", install);
      element.removeEventListener("attached", refresh);
      void pause();
    },
    { pause, resume },
  );
}
