import { installControlFeedback, type ControlActivity } from "@ovule/ui/control-feedback";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { ExplorerDownload, ExplorerElement } from "./explorer";
import type { TFunction } from "i18next";
import "./explorer-resources.css";
import { downloadHistory } from "./downloads-service";
import type { DownloadsService } from "./downloads";
import { loadExplorer } from "./preview-loader";
import { installExplorerCode } from "./explorer-code";

export function downloadProgress(item: ExplorerDownload): number | undefined {
  return item.totalBytes > 0
    ? Math.max(0, Math.min(1, item.receivedBytes / item.totalBytes))
    : undefined;
}

/** Downloads use the Explorer's cookies and partition; completed bytes are read
 * by opaque item ID, never an application-supplied filesystem path. */
export function installExplorerResources(
  element: ExplorerElement,
  t: TFunction,
  downloads: DownloadsService = downloadHistory,
): () => void {
  const host = element.parentElement;
  if (!host) return () => {};
  const removeCode = installExplorerCode(element);
  const removePreview = loadExplorer.observe(element);
  host.classList.add("explorer-resource-host");
  const surface = document.createElement("div");
  surface.className = "explorer-resource-ui";
  host.append(surface);
  const feedback = installControlFeedback(host);
  // Host adapters can report input in surface CSS coordinates. Guest page events
  // cannot bubble through the Explorer WebContents boundary.
  const activity = (event: Event) => feedback.pulse((event as CustomEvent<ControlActivity>).detail);
  const clearFeedback = () => feedback.clear();
  element.addEventListener("ovule:control-activity", activity);
  element.addEventListener("detached", clearFeedback);
  element.addEventListener("loaderror", clearFeedback);
  const loading = document.createElement("div");
  loading.className = "explorer-loading-indicator";
  loading.setAttribute("role", "progressbar");
  loading.setAttribute("aria-label", t("browser.loadingPage"));
  loading.hidden = true;
  host.append(loading);
  let loadingRevision = 0;
  const started = () => {
    loadingRevision++;
    loading.hidden = false;
  };
  const stopped = () => {
    loadingRevision++;
    loading.hidden = true;
  };
  const syncLoading = () => {
    if (typeof element.getNavigationState !== "function") return;
    const revision = loadingRevision;
    void element
      .getNavigationState()
      .then((state) => {
        if (!disposed && revision === loadingRevision) loading.hidden = !state.isLoading;
      })
      .catch(() => {});
  };
  element.addEventListener("loadstart", started);
  element.addEventListener("loadstop", stopped);
  element.addEventListener("loaderror", stopped);
  element.addEventListener("error", stopped);
  element.addEventListener("detached", stopped);
  element.addEventListener("renderprocessgone", stopped);
  element.addEventListener("attached", syncLoading);
  const previousDownloads = new Map<number, ExplorerDownload>();
  let disposed = false;
  let pdfId: number | undefined;
  let pdfUrl: string | undefined;
  let pdfGeneration = 0;
  let destroyPdf: (() => void) | undefined;
  let pdfSurface: HTMLDivElement | undefined;
  const clearPdf = () => {
    pdfGeneration++;
    destroyPdf?.();
    destroyPdf = undefined;
    pdfSurface?.remove();
    pdfSurface = undefined;
    pdfId = undefined;
    pdfUrl = undefined;
  };
  const showPdf = async (item: ExplorerDownload) => {
    if (pdfId === item.id) return;
    clearPdf();
    pdfId = item.id;
    pdfUrl = item.url;
    const generation = pdfGeneration;
    const viewer = document.createElement("div");
    viewer.className = "explorer-pdf";
    const status = document.createElement("div");
    status.className = "explorer-pdf-status";
    status.textContent = t("browser.pdfLoading");
    viewer.append(status);
    surface.prepend(viewer);
    pdfSurface = viewer;
    try {
      const [pdfjs, encoded] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        element.readDownload(item.id),
      ]);
      if (disposed || generation !== pdfGeneration) return;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const data = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const task = pdfjs.getDocument({ data, isEvalSupported: false });
      destroyPdf = () => {
        void task.destroy();
      };
      const pdf = await task.promise;
      if (disposed || generation !== pdfGeneration) return;
      status.textContent = `${item.filename} · ${pdf.numPages} ${t("browser.pdfPages")}`;
      // Render pages when they approach the viewport, bounding work and memory
      // for model cards and other large documents.
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const canvas = entry.target as HTMLCanvasElement;
            void (async () => {
              const page = await pdf.getPage(Number(canvas.dataset.page));
              if (disposed || generation !== pdfGeneration) return;
              const width = Math.max(240, viewer.clientWidth - 32);
              const scale = Math.min(2, width / page.getViewport({ scale: 1 }).width);
              const viewport = page.getViewport({ scale });
              const ratio = Math.min(2, devicePixelRatio || 1);
              canvas.width = Math.ceil(viewport.width * ratio);
              canvas.height = Math.ceil(viewport.height * ratio);
              canvas.style.width = `${viewport.width}px`;
              canvas.style.height = `${viewport.height}px`;
              const render = page.render({
                canvas,
                viewport,
                transform: [ratio, 0, 0, ratio, 0, 0],
              });
              await render.promise;
              canvas.dataset.rendered = "true";
              viewer.dataset.ready = "true";
              page.cleanup();
            })().catch((error) => {
              if (!disposed && generation === pdfGeneration) {
                status.textContent = String(error);
                viewer.dataset.ready = "true";
              }
            });
          }
        },
        { root: viewer, rootMargin: "600px" },
      );
      destroyPdf = () => {
        observer.disconnect();
        void task.destroy();
      };
      for (let page = 1; page <= pdf.numPages; page++) {
        const canvas = document.createElement("canvas");
        canvas.dataset.page = String(page);
        canvas.style.height = "900px";
        canvas.setAttribute("aria-label", `${t("browser.pdfPage")} ${page}`);
        viewer.append(canvas);
        observer.observe(canvas);
      }
    } catch (error) {
      if (!disposed && generation === pdfGeneration) {
        status.textContent = t("browser.pdfFailed", { error: String(error) });
        viewer.dataset.ready = "true";
      }
    }
  };
  const update = (item: ExplorerDownload) => {
    if (disposed) return;
    const previous = previousDownloads.get(item.id);
    previousDownloads.set(item.id, item);
    downloads.update(element, item);
    if (
      item.navigation &&
      typeof element.getNavigationState === "function" &&
      (previous?.state !== item.state || previous?.filename !== item.filename)
    ) {
      void element
        .getNavigationState()
        .then((state) => {
          if (!disposed)
            element.dispatchEvent(new CustomEvent("resourcenavigation", { detail: state }));
        })
        .catch(console.error);
    }
    if (item.navigation && item.mimeType === "application/pdf") {
      if (item.state === "complete") void showPdf(item);
      else if (item.state === "in-progress" && pdfId === undefined) {
        pdfUrl = item.url;
        if (!pdfSurface) {
          pdfSurface = document.createElement("div");
          pdfSurface.className = "explorer-pdf";
          const status = document.createElement("div");
          status.className = "explorer-pdf-status";
          status.textContent = t("browser.pdfLoading");
          pdfSurface.append(status);
          surface.prepend(pdfSurface);
        }
      } else if (item.state !== "in-progress" && pdfId === undefined) clearPdf();
    }
  };
  const changed = (event: Event) => update((event as CustomEvent<ExplorerDownload>).detail);
  const replay = () => {
    if (typeof element.getDownloads === "function")
      void element
        .getDownloads()
        .then((items) => items.forEach(update))
        .catch(console.error);
  };
  const committed = (event: Event) => {
    const state = (event as CustomEvent<{ url?: string; isLoading?: boolean }>).detail;
    if (typeof state?.isLoading === "boolean") {
      loadingRevision++;
      loading.hidden = !state.isLoading;
    }
    if (state?.url !== pdfUrl) clearPdf();
  };
  element.addEventListener("download", changed);
  element.addEventListener("attached", replay);
  element.addEventListener("loadcommit", committed);
  replay();
  syncLoading();
  return () => {
    removeCode();
    removePreview();
    disposed = true;
    feedback.dispose();
    element.removeEventListener("loadstart", started);
    element.removeEventListener("loadstop", stopped);
    element.removeEventListener("loaderror", stopped);
    element.removeEventListener("error", stopped);
    element.removeEventListener("detached", stopped);
    element.removeEventListener("renderprocessgone", stopped);
    element.removeEventListener("attached", syncLoading);
    loading.remove();
    element.removeEventListener("ovule:control-activity", activity);
    element.removeEventListener("detached", clearFeedback);
    element.removeEventListener("loaderror", clearFeedback);
    clearPdf();
    element.removeEventListener("download", changed);
    element.removeEventListener("attached", replay);
    element.removeEventListener("loadcommit", committed);
    surface.remove();
  };
}
