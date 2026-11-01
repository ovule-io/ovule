import { useEffect, useRef, useState } from "react";
import "./preview.css";
import { PanelLeft } from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { FilePreviewState, filePreviewName } from "../shared/file-preview-state";
GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreview({
  url,
  loadFile,
}: {
  url: string;
  loadFile(): Promise<{ bytes: number[] | Uint8Array }>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const thumbnails = useRef<HTMLElement>(null);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState("width");
  const modeRef = useRef(mode);
  const relayout = useRef<(() => void) | undefined>(undefined);
  const [count, setCount] = useState(0);
  const [current, setCurrent] = useState(1);
  useEffect(() => {
    const nav = thumbnails.current;
    if (!nav) return;
    for (const button of nav.querySelectorAll("button")) {
      if (button.dataset.page === String(current)) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    const button = nav.querySelector('[aria-current="page"]');
    if (button) {
      const bounds = button.getBoundingClientRect();
      const viewport = nav.getBoundingClientRect();
      if (bounds.top < viewport.top) nav.scrollTop -= viewport.top - bounds.top;
      else if (bounds.bottom > viewport.bottom) nav.scrollTop += bounds.bottom - viewport.bottom;
    }
  }, [current]);
  useEffect(() => {
    modeRef.current = mode;
    relayout.current?.();
  }, [mode]);
  useEffect(() => {
    const host = root.current;
    const nav = thumbnails.current;
    if (!host || !nav) return;
    setError(undefined);
    setReady(false);
    let active = true;
    let cleanup = () => {};
    void (async () => {
      const file = await loadFile();
      if (!active) return;
      const task = getDocument({
        data: Uint8Array.from(file.bytes),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      cleanup = () => void task.destroy();
      const pdf = await task.promise;
      if (!active) return;
      setCount(pdf.numPages);
      const pages = new Map<
        HTMLCanvasElement,
        {
          page: Awaited<ReturnType<typeof pdf.getPage>>;
          rendering: boolean;
          again: boolean;
          width: number;
          cancel?: () => void;
        }
      >();
      const pageWidth = (page: Awaited<ReturnType<typeof pdf.getPage>>) => {
        const columns = modeRef.current === "spread" ? 2 : 1;
        const width = Math.max(1, (host.clientWidth - 32 - (columns - 1) * 16) / columns);
        const base = page.getViewport({ scale: 1 });
        return modeRef.current === "height"
          ? Math.min(width, (Math.max(1, host.clientHeight - 32) * base.width) / base.height)
          : width;
      };
      const render = async (canvas: HTMLCanvasElement) => {
        const entry = pages.get(canvas);
        if (!entry || !active) return;
        if (entry.rendering) {
          entry.again = true;
          entry.cancel?.();
          return;
        }
        entry.rendering = true;
        try {
          do {
            entry.again = false;
            const width = pageWidth(entry.page);
            const base = entry.page.getViewport({ scale: 1 });
            const viewport = entry.page.getViewport({ scale: width / base.width });
            const ratio = Math.min(
              2,
              devicePixelRatio || 1,
              Math.sqrt(16000000 / (viewport.width * viewport.height)),
            );
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            delete canvas.dataset.rendered;
            // Commit complete frames only; cancelled resizes must not clear the visible page.
            const buffer = document.createElement("canvas");
            buffer.width = Math.ceil(viewport.width * ratio);
            buffer.height = Math.ceil(viewport.height * ratio);
            const draw = entry.page.render({
              canvas: buffer,
              viewport,
              transform: [ratio, 0, 0, ratio, 0, 0],
            });
            entry.cancel = () => draw.cancel();
            try {
              await draw.promise;
            } catch (error) {
              if (!(error instanceof Error) || error.name !== "RenderingCancelledException")
                throw error;
              continue;
            }
            if (width !== pageWidth(entry.page)) entry.again = true;
            if (active && !entry.again) {
              canvas.width = buffer.width;
              canvas.height = buffer.height;
              canvas.getContext("2d")!.drawImage(buffer, 0, 0);
              entry.width = width;
              canvas.dataset.rendered = "true";
              setReady(true);
            }
          } while (active && entry.again);
        } finally {
          entry.rendering = false;
          entry.cancel = undefined;
        }
      };
      const fail = (error: unknown) => {
        if (active) setError(String(error));
      };
      const observe = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              const canvas = entry.target as HTMLCanvasElement;
              if (pages.get(canvas)?.width !== pageWidth(pages.get(canvas)!.page))
                void render(canvas).catch(fail);
            }
        },
        { root: host, rootMargin: "600px" },
      );
      const thumbnailPages = new Map<HTMLCanvasElement, Awaited<ReturnType<typeof pdf.getPage>>>();
      const thumbnailTasks = new Set<{ cancel(): void }>();
      const renderThumbnail = async (canvas: HTMLCanvasElement) => {
        const page = thumbnailPages.get(canvas);
        if (!page || canvas.dataset.rendered) return;
        canvas.dataset.rendered = "pending";
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(96 / base.width, 136 / base.height) });
        canvas.width = Math.ceil(viewport.width * 2);
        canvas.height = Math.ceil(viewport.height * 2);
        const draw = page.render({ canvas, viewport, transform: [2, 0, 0, 2, 0, 0] });
        thumbnailTasks.add(draw);
        try {
          await draw.promise;
          if (active) canvas.dataset.rendered = "true";
        } finally {
          thumbnailTasks.delete(draw);
        }
      };
      const thumbnailObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting)
              void renderThumbnail(entry.target as HTMLCanvasElement).catch((error) => {
                if (active) fail(error);
              });
        },
        { root: nav, rootMargin: "300px" },
      );
      const layout = () => {
        host.style.gridTemplateColumns =
          modeRef.current === "spread" ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)";
        for (const [canvas, entry] of pages) {
          const width = pageWidth(entry.page);
          if (entry.width !== width) delete canvas.dataset.rendered;
          const base = entry.page.getViewport({ scale: 1 });
          canvas.style.width = `${width}px`;
          canvas.style.height = `${(width * base.height) / base.width}px`;
          observe.unobserve(canvas);
          observe.observe(canvas);
        }
      };
      relayout.current = layout;
      const resize = new ResizeObserver(layout);
      let requestedScroll: number | undefined;
      const scrolled = () => {
        if (requestedScroll === host.scrollTop) return;
        requestedScroll = undefined;
        const bounds = host.getBoundingClientRect();
        let best = 1;
        let distance = Infinity;
        [...pages.keys()].forEach((canvas, index) => {
          const delta = Math.abs(canvas.getBoundingClientRect().top - bounds.top - 16);
          if (delta < distance) {
            best = index + 1;
            distance = delta;
          }
        });
        setCurrent(best);
      };
      host.addEventListener("scroll", scrolled, { passive: true });
      resize.observe(host);
      cleanup = () => {
        relayout.current = undefined;
        host.removeEventListener("scroll", scrolled);
        observe.disconnect();
        thumbnailObserver.disconnect();
        for (const task of thumbnailTasks) task.cancel();
        resize.disconnect();
        for (const entry of pages.values()) entry.cancel?.();
        void task.destroy();
      };
      for (let number = 1; number <= pdf.numPages && active; number++) {
        const page = await pdf.getPage(number);
        if (!active) return;
        const canvas = document.createElement("canvas");
        canvas.className = "preview-pdf-page";
        canvas.style.aspectRatio = String(
          page.getViewport({ scale: 1 }).width / page.getViewport({ scale: 1 }).height,
        );
        canvas.setAttribute("aria-label", `Page ${number} of ${pdf.numPages}`);
        pages.set(canvas, { page, rendering: false, again: false, width: 0 });
        host.append(canvas);
        observe.observe(canvas);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "preview-page-thumbnail";
        button.dataset.page = String(number);
        button.setAttribute("aria-label", `Page ${number}`);
        if (number === 1) button.setAttribute("aria-current", "page");
        const frame = document.createElement("span");
        frame.className = "preview-thumbnail-frame";
        frame.setAttribute("aria-hidden", "true");
        const thumb = document.createElement("canvas");
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(96 / base.width, 136 / base.height);
        thumb.style.width = `${base.width * scale}px`;
        thumb.style.height = `${base.height * scale}px`;
        frame.append(thumb);
        const label = document.createElement("span");
        label.textContent = String(number);
        button.append(frame, label);
        button.onclick = () => {
          host.scrollTop +=
            canvas.getBoundingClientRect().top - host.getBoundingClientRect().top - 16;
          requestedScroll = host.scrollTop;
          setCurrent(number);
        };
        nav.append(button);
        thumbnailPages.set(thumb, page);
        thumbnailObserver.observe(thumb);
      }
      layout();
    })().catch((error) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
      cleanup();
      host.replaceChildren();
      nav.replaceChildren();
    };
  }, [url, loadFile]);
  if (error) return <FilePreviewState error={error} fileName={filePreviewName(url)} />;
  return (
    <main className="preview-pdf" data-preview-pdf-url={url} data-ready={ready}>
      <nav className="preview-document-toolbar" aria-label="Document view">
        <button
          className="preview-thumbnails-toggle"
          aria-label={showThumbnails ? "Hide page thumbnails" : "Show page thumbnails"}
          aria-expanded={showThumbnails}
          onClick={() => setShowThumbnails((value) => !value)}
        >
          <PanelLeft size={16} />
        </button>
        <span className="preview-page-status" aria-live="polite">
          Page {current} of {count}
        </span>
        <select
          aria-label="Page display mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="width">Fit width</option>
          <option value="height">Fit height</option>
          <option value="spread">Two pages</option>
        </select>
      </nav>
      {!ready && (
        <div className="preview-pdf-loading">
          <FilePreviewState kind="loading" />
        </div>
      )}
      <div className="preview-pdf-workspace" data-thumbnails={showThumbnails}>
        <nav
          ref={thumbnails}
          className="preview-page-thumbnails"
          aria-label="Pages"
          hidden={!showThumbnails}
        />
        <div ref={root} className="preview-pdf-pages" tabIndex={0} aria-label="PDF pages" />
      </div>
    </main>
  );
}
