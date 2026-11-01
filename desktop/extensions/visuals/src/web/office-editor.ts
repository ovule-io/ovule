import { request } from "../isolated";
import "./office-browser-platform.mjs";
import { renderAsync } from "docx-preview";
import ExcelJS from "exceljs";
import { normalizeSpreadsheetStrings } from "./spreadsheet-compat";
import { PPTXViewer } from "pptxviewjs";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

(
  globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler };
  }
).pdfjsWorker = { WorkerMessageHandler };

GlobalWorkerOptions.workerSrc = "/extensions/visuals/dist/web/pdf.worker.mjs";

type OfficeFile = {
  name: string;
  extension: string;
  bytes: Uint8Array;
  readOnly: boolean;
};

const { default: stylesheet } = await import(
  new URL("./web/office-editor.css", import.meta.url).href,
  { with: { type: "css" } }
);

class OvuleOfficeEditor extends HTMLElement {
  #file?: OfficeFile;
  #chunks: number[] = [];
  set fileChunk(value: {
    offset: number;
    bytes: number[];
    metadata?: Omit<OfficeFile, "bytes">;
    done: boolean;
  }) {
    if (value.offset === 0) this.#chunks = [];
    if (
      value.offset !== this.#chunks.length ||
      this.#chunks.length + value.bytes.length > 16 * 1024 * 1024
    )
      throw new Error("Invalid file transfer");
    this.#chunks.push(...value.bytes);
    if (value.done && value.metadata) {
      this.file = { ...value.metadata, bytes: Uint8Array.from(this.#chunks) };
      this.#chunks = [];
    }
  }
  set exportRevision(revision: number) {
    void this.#sendExport(revision);
  }
  async #sendExport(revision: number) {
    try {
      const bytes = await this.exportFile();
      if (bytes.length > 16 * 1024 * 1024) throw new Error("File exceeds 16 MiB");
      for (let offset = 0; offset < bytes.length || offset === 0; offset += 32768) {
        await request(this, "file.export", {
          revision,
          offset,
          bytes: Array.from(bytes.subarray(offset, offset + 32768)),
          done: offset + 32768 >= bytes.length,
        });
      }
    } catch (error) {
      await request(this, "file.exportError", {
        revision,
        message: String(error instanceof Error ? error.message : error),
      }).catch(() => {});
    }
  }

  #workbook?: ExcelJS.Workbook;
  #root?: HTMLElement;
  #viewer?: PPTXViewer;
  #renderGeneration = 0;
  #resizeObserver?: ResizeObserver;
  #thumbnailObserver?: IntersectionObserver;
  #resizeFrame?: number;
  #presentationRefresh?: ReturnType<typeof setTimeout>;

  set file(value: OfficeFile | undefined) {
    this.#file = value
      ? {
          ...value,
          extension: value.extension.toLowerCase(),
          bytes: Uint8Array.from(value.bytes),
        }
      : undefined;
    void this.#render();
  }

  get file(): OfficeFile | undefined {
    return this.#file;
  }

  connectedCallback() {
    const root = this.getRootNode();
    if (root instanceof ShadowRoot && !root.adoptedStyleSheets.includes(stylesheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, stylesheet];
    }
    if (!this.#root) {
      this.#root = document.createElement("div");
      this.#root.className = "office-root";
      this.append(this.#root);
    }
    void this.#render();
  }

  disconnectedCallback() {
    this.#renderGeneration++;
    this.#resizeObserver?.disconnect();
    this.#thumbnailObserver?.disconnect();
    if (this.#resizeFrame !== undefined) cancelAnimationFrame(this.#resizeFrame);
    clearTimeout(this.#presentationRefresh);
    this.#viewer?.destroy();
    this.#viewer = undefined;
  }

  async exportFile(): Promise<Uint8Array> {
    if (!this.#file || !this.#workbook || this.#file.readOnly) {
      throw new Error("This Office document is read-only");
    }
    const output =
      this.#file.extension === "csv"
        ? await this.#workbook.csv.writeBuffer()
        : await this.#workbook.xlsx.writeBuffer();
    return new Uint8Array(output);
  }

  async #render() {
    if (!this.isConnected || !this.#root || !this.#file) return;
    const generation = ++this.#renderGeneration;
    this.#resizeObserver?.disconnect();
    this.#thumbnailObserver?.disconnect();
    if (this.#resizeFrame !== undefined) cancelAnimationFrame(this.#resizeFrame);
    clearTimeout(this.#presentationRefresh);
    this.#viewer?.destroy();
    this.#viewer = undefined;
    this.#workbook = undefined;
    this.#root.onscroll = null;
    this.#root.classList.remove("office-word-layout");
    this.#root.replaceChildren();
    try {
      if (["docx", "dotx"].includes(this.#file.extension)) {
        const host = document.createElement("div");
        host.className = "office-word";
        host.tabIndex = 0;
        host.setAttribute("aria-label", "Word pages");
        this.#root.classList.add("office-word-layout");
        const workspace = document.createElement("div");
        workspace.className = "office-word-workspace";
        const thumbnails = document.createElement("nav");
        thumbnails.className = "office-page-thumbnails";
        thumbnails.setAttribute("aria-label", "Pages");
        workspace.append(thumbnails, host);
        this.#root.append(workspace);
        await renderAsync(this.#file.bytes, host, host, {
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          useBase64URL: true,
        });
        if (generation !== this.#renderGeneration || !this.isConnected) return;
        const pages = [...host.querySelectorAll<HTMLElement>("section.docx")];
        const wrapper = host.querySelector<HTMLElement>(".docx-wrapper");
        const slots = pages.map((page) => {
          const slot = document.createElement("div");
          slot.className = "office-word-page";
          page.replaceWith(slot);
          slot.append(page);
          return slot;
        });
        const toolbar = document.createElement("nav");
        toolbar.className = "office-document-toolbar";
        toolbar.setAttribute("aria-label", "Document view");
        const mode = document.createElement("select");
        mode.setAttribute("aria-label", "Page display mode");
        for (const [value, label] of [
          ["width", "Fit width"],
          ["height", "Fit height"],
          ["spread", "Two pages"],
        ]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          mode.append(option);
        }
        const toggle = document.createElement("button");
        toggle.className = "office-thumbnails-toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-label", "Hide page thumbnails");
        toggle.setAttribute("aria-expanded", "true");
        toggle.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>';
        const status = document.createElement("span");
        status.className = "office-page-status";
        status.setAttribute("aria-live", "polite");
        toolbar.append(toggle, status, mode);
        this.#root.prepend(toolbar);
        const thumbnailPages = new Map<HTMLElement, HTMLElement>();
        this.#thumbnailObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const frame = entry.target as HTMLElement;
              const page = thumbnailPages.get(frame);
              if (!entry.isIntersecting || !page || frame.childElementCount) continue;
              const clone = page.cloneNode(true) as HTMLElement;
              clone.removeAttribute("id");
              for (const node of clone.querySelectorAll("[id]")) node.removeAttribute("id");
              clone.style.transform = `scale(${frame.clientWidth / Math.max(1, page.offsetWidth)})`;
              frame.append(clone);
            }
          },
          { root: thumbnails, rootMargin: "300px" },
        );
        const buttons = pages.map((page, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "office-page-thumbnail";
          button.dataset.page = String(index + 1);
          button.setAttribute("aria-label", `Page ${index + 1}`);
          const frame = document.createElement("span");
          frame.className = "office-thumbnail-frame";
          frame.setAttribute("aria-hidden", "true");
          frame.inert = true;
          const width = Math.max(1, page.offsetWidth);
          const height = Math.max(1, page.offsetHeight);
          const scale = Math.min(96 / width, 136 / height);
          frame.style.width = `${width * scale}px`;
          frame.style.height = `${height * scale}px`;
          thumbnailPages.set(frame, page);
          this.#thumbnailObserver!.observe(frame);
          const label = document.createElement("span");
          label.textContent = String(index + 1);
          button.append(frame, label);
          button.onclick = () => navigate(index + 1);
          thumbnails.append(button);
          return button;
        });
        let currentPage = -1;
        let requestedScroll: number | undefined;
        const updatePage = (requestedPage?: number) => {
          const top = host.getBoundingClientRect().top + 16;
          let selected = 0;
          let distance = Infinity;
          slots.forEach((page, index) => {
            const delta = Math.abs(page.getBoundingClientRect().top - top);
            if (delta < distance) {
              selected = index;
              distance = delta;
            }
          });
          if (requestedPage !== undefined) selected = requestedPage;
          if (currentPage !== selected) {
            const button = buttons[selected];
            if (button) {
              const bounds = button.getBoundingClientRect();
              const viewport = thumbnails.getBoundingClientRect();
              if (bounds.top < viewport.top) thumbnails.scrollTop -= viewport.top - bounds.top;
              else if (bounds.bottom > viewport.bottom)
                thumbnails.scrollTop += bounds.bottom - viewport.bottom;
            }
          }
          currentPage = selected;
          status.textContent = `Page ${selected + 1} of ${pages.length}`;
          buttons.forEach((button, index) => {
            if (index === selected) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
          });
        };
        const navigate = (value: number) => {
          if (!Number.isInteger(value)) return;
          const page = Math.max(1, Math.min(pages.length, value));
          const slot = slots[page - 1];
          if (!slot) return;
          host.scrollTop +=
            slot.getBoundingClientRect().top - host.getBoundingClientRect().top - 16;
          requestedScroll = host.scrollTop;
          updatePage(page - 1);
        };
        const fitPages = () => {
          const columns = mode.value === "spread" ? 2 : 1;
          if (wrapper) wrapper.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
          const available = Math.max(1, (host.clientWidth - 32 - (columns - 1) * 16) / columns);
          pages.forEach((page, index) => {
            const width = page.offsetWidth;
            const height = page.offsetHeight;
            const widthScale = available / Math.max(1, width);
            const scale =
              mode.value === "height"
                ? Math.min(widthScale, Math.max(1, host.clientHeight - 32) / Math.max(1, height))
                : widthScale;
            page.style.transform = `scale(${scale})`;
            slots[index].style.width = `${width * scale}px`;
            slots[index].style.height = `${height * scale}px`;
          });
          updatePage();
        };
        mode.onchange = fitPages;
        toggle.onclick = () => {
          thumbnails.hidden = !thumbnails.hidden;
          workspace.classList.toggle("thumbnails-hidden", thumbnails.hidden);
          toggle.setAttribute("aria-expanded", String(!thumbnails.hidden));
          toggle.setAttribute(
            "aria-label",
            thumbnails.hidden ? "Show page thumbnails" : "Hide page thumbnails",
          );
          fitPages();
        };
        host.onscroll = () => {
          if (requestedScroll === host.scrollTop) return;
          requestedScroll = undefined;
          updatePage();
        };
        fitPages();
        this.#resizeObserver = new ResizeObserver(fitPages);
        this.#resizeObserver.observe(host);
      } else if (this.#file.extension === "pdf") {
        await this.#renderPdf();
      } else if (["pptx", "pptm", "ppsx"].includes(this.#file.extension)) {
        await this.#renderPresentation();
      } else {
        await this.#renderSpreadsheet();
      }
      if (generation === this.#renderGeneration && this.isConnected)
        void request(this, "file.previewReady").catch(() => {});
    } catch (error) {
      if (generation !== this.#renderGeneration) return;
      const failure = document.createElement("div");
      failure.className = "office-error";
      failure.textContent = error instanceof Error ? error.message : String(error);
      this.#root.replaceChildren(failure);
      void request(this, "file.previewError", { message: failure.textContent }).catch(() => {});
    }
  }

  async #renderPdf() {
    if (!this.#root || !this.#file) return;
    const host = document.createElement("div");
    host.className = "office-pdf";
    this.#root.append(host);
    const pdf = await getDocument({
      data: Uint8Array.from(this.#file.bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(1.5, 1100 / base.width),
      });
      const canvas = document.createElement("canvas");
      canvas.className = "office-pdf-page";
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute("aria-label", `Page ${pageNumber} of ${pdf.numPages}`);
      host.append(canvas);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("PDF canvas is unavailable");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    }
  }

  async #renderSpreadsheet() {
    if (!this.#root || !this.#file) return;
    let workbook = new ExcelJS.Workbook();
    let sheetNames: Record<string, string> = {};
    if (this.#file.extension === "csv") {
      const rows = parseCsv(new TextDecoder().decode(this.#file.bytes));
      const sheet = workbook.addWorksheet("Sheet 1");
      for (const row of rows) sheet.addRow(row);
    } else {
      try {
        await workbook.xlsx.load(this.#file.bytes as unknown as ExcelJS.Buffer);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/Cannot create property .richText. on string|Worksheet name already exists/.test(
            error.message,
          )
        )
          throw error;
        const normalized = await normalizeSpreadsheetStrings(this.#file.bytes);
        workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(normalized.bytes as unknown as ExcelJS.Buffer);
        sheetNames = normalized.sheetNames;
      }
    }
    this.#workbook = workbook;
    const host = document.createElement("div");
    host.className = "office-sheet";
    const tabs = document.createElement("nav");
    tabs.className = "office-sheet-tabs";
    const grid = document.createElement("div");
    grid.className = "office-grid-wrap";
    const showSheet = (worksheet: ExcelJS.Worksheet) => {
      for (const button of tabs.querySelectorAll("button")) {
        button.setAttribute("aria-selected", String(button.dataset.sheet === worksheet.name));
      }
      grid.replaceChildren(
        renderSheet(worksheet, Boolean(this.#file?.readOnly), () => {
          void request(this, "file.dirty").catch(() => {});
        }),
      );
    };
    for (const worksheet of workbook.worksheets) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.sheet = worksheet.name;
      button.textContent = sheetNames[worksheet.name] ?? worksheet.name;
      button.addEventListener("click", () => showSheet(worksheet));
      tabs.append(button);
    }
    host.append(tabs, grid);
    this.#root.append(host);
    const first = workbook.worksheets[0];
    if (first) showSheet(first);
  }

  async #renderPresentation() {
    if (!this.#root || !this.#file) return;
    const host = document.createElement("div");
    host.className = "office-presentation";
    const canvas = document.createElement("canvas");
    const stage = document.createElement("div");
    stage.className = "office-presentation-stage";
    const nav = document.createElement("div");
    nav.className = "office-presentation-nav";
    const previous = document.createElement("button");
    previous.textContent = "←";
    const status = document.createElement("span");
    const next = document.createElement("button");
    next.textContent = "→";
    nav.append(previous, status, next);
    stage.append(canvas);
    host.append(stage, nav);
    this.#root.append(host);
    // The library's delayed re-render outlives destroy() and rejects without a
    // handler. Own the refresh here so closing/switching a file cancels it.
    const viewer = new PPTXViewer({
      canvas,
      slideSizeMode: "fit",
      autoRenderFirstSlide: false,
      autoChartRerenderDelayMs: 0,
    });
    this.#viewer = viewer;
    await viewer.loadFile(this.#file.bytes);
    if (!this.isConnected || this.#viewer !== viewer) return;
    const size = (
      viewer as unknown as { presentation?: { slideSize?: { cx: number; cy: number } } }
    ).presentation?.slideSize;
    const aspect = size?.cx && size.cy ? size.cx / size.cy : 4 / 3;
    let slideIndex = 0;
    let rendering = false;
    let repeat = false;
    const update = async () => {
      if (rendering) {
        repeat = true;
        return;
      }
      rendering = true;
      try {
        do {
          repeat = false;
          if (!this.isConnected || this.#viewer !== viewer) return;
          const width = Math.max(
            1,
            Math.min(stage.clientWidth - 32, (stage.clientHeight - 24) * aspect),
          );
          const height = width / aspect;
          const ratio = Math.min(2, devicePixelRatio || 1);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
          canvas.width = Math.round(width * ratio);
          canvas.height = Math.round(height * ratio);
          await viewer.render(canvas, { quality: "high", slideIndex });
        } while (repeat);
      } finally {
        rendering = false;
      }
      if (!this.isConnected || this.#viewer !== viewer) return;
      status.textContent = `${viewer.getCurrentSlideIndex() + 1} / ${viewer.getSlideCount()}`;
      previous.disabled = slideIndex === 0;
      next.disabled = slideIndex === viewer.getSlideCount() - 1;
    };
    const failed = (error: unknown) => {
      if (this.isConnected && this.#viewer === viewer) status.textContent = String(error);
    };
    previous.addEventListener("click", () => {
      slideIndex = Math.max(0, slideIndex - 1);
      void update().catch(failed);
    });
    next.addEventListener("click", () => {
      slideIndex = Math.min(viewer.getSlideCount() - 1, slideIndex + 1);
      void update().catch(failed);
    });
    await update();
    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#resizeFrame !== undefined) cancelAnimationFrame(this.#resizeFrame);
      this.#resizeFrame = requestAnimationFrame(() => void update().catch(failed));
    });
    this.#resizeObserver.observe(stage);
    this.#presentationRefresh = setTimeout(() => {
      if (this.isConnected && this.#viewer === viewer) void update().catch(failed);
    }, 200);
  }
}

function renderSheet(worksheet: ExcelJS.Worksheet, readOnly: boolean, dirty: () => void) {
  const table = document.createElement("table");
  table.className = "office-grid";
  const rows = Math.min(Math.max(worksheet.rowCount, 30), 500);
  const columns = Math.min(Math.max(worksheet.columnCount, 12), 100);
  const merged = new Map<string, { rows: number; columns: number }>();
  const covered = new Set<string>();
  for (const range of worksheet.model.merges ?? []) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!match) continue;
    const columnIndex = (letters: string) =>
      [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
    const firstColumn = columnIndex(match[1]);
    const firstRow = Number(match[2]);
    const lastColumn = Math.min(columns, columnIndex(match[3]));
    const lastRow = Math.min(rows, Number(match[4]));
    if (firstColumn > columns || firstRow > rows) continue;
    merged.set(`${firstRow}:${firstColumn}`, {
      rows: lastRow - firstRow + 1,
      columns: lastColumn - firstColumn + 1,
    });
    for (let row = firstRow; row <= lastRow; row++)
      for (let column = firstColumn; column <= lastColumn; column++)
        if (row !== firstRow || column !== firstColumn) covered.add(`${row}:${column}`);
  }
  const head = document.createElement("thead");
  const headings = document.createElement("tr");
  headings.append(document.createElement("th"));
  for (let column = 1; column <= columns; column += 1) {
    const cell = document.createElement("th");
    cell.textContent = columnName(column);
    headings.append(cell);
  }
  head.append(headings);
  const body = document.createElement("tbody");
  for (let row = 1; row <= rows; row += 1) {
    const line = document.createElement("tr");
    const number = document.createElement("th");
    number.className = "office-row-number";
    number.textContent = String(row);
    line.append(number);
    for (let column = 1; column <= columns; column += 1) {
      if (covered.has(`${row}:${column}`)) continue;
      const container = document.createElement("td");
      const span = merged.get(`${row}:${column}`);
      if (span) {
        container.colSpan = span.columns;
        container.rowSpan = span.rows;
      }
      const input = document.createElement("input");
      const cell = worksheet.getCell(row, column);
      input.value = cell.master.text;
      input.title = input.value;
      input.readOnly = readOnly;
      if (!readOnly) {
        input.addEventListener("input", () => {
          cell.value = input.value;
          dirty();
        });
      }
      container.append(input);
      line.append(container);
    }
    body.append(line);
  }
  table.append(head, body);
  return table;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [[""]];
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        const row = rows.at(-1)!;
        row[row.length - 1] += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) rows.at(-1)!.push("");
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      rows.push([""]);
    } else {
      const row = rows.at(-1)!;
      row[row.length - 1] += character;
    }
  }
  if (rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "") rows.pop();
  return rows;
}

function columnName(index: number): string {
  let value = index;
  let result = "";
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function registerFileEditor(registry: CustomElementRegistry, tag = "ovule-office-editor") {
  if (!registry.get(tag)) registry.define(tag, OvuleOfficeEditor);
}
