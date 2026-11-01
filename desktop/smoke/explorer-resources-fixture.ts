import "@ovule/ui/styles.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { I18nextProvider } from "react-i18next";
import "@ovule/ui/styles.css";
import "@ovule/ui/theme.css";
import { createDownloadsService } from "../features/shell/src/downloads-service";
import { installExplorerResources as installResources } from "../features/shell/src/explorer-resources";
import { defaultShellService } from "../features/shell/src/service";
import type { DownloadView } from "@ovule/shell-api";
import { createRegistry, createScope } from "@ovule/ioc-container";
import registerI18n from "@ovule/i18n/i18n.provider";
import registerShell from "@ovule/shell/app.provider";
import i18nTokens from "@ovule/i18n/i18n.token";
import shellTokens from "@ovule/shell/shell.token";
import type { MountIsolated } from "@ovule/shell/isolated";
import type { ExplorerDownload, ExplorerElement } from "@ovule/shell/explorer";
import { FileBreadcrumbs } from "../features/browser/src/FileBreadcrumbs";
import { installExplorerCode } from "../features/shell/src/explorer-code";
import { localExplorerSource } from "../features/shell/src/local-files";
import { PdfPreview } from "../src/preview/pdf/preview";
import { HtmlPreview } from "../src/preview/html/preview";
import { CodePreview } from "../src/preview/code/preview";
import { OfficePreview } from "../src/preview/office/preview";
import { MarkdownPreview } from "../src/preview/markdown/preview";
import { FilePreviewState } from "../src/preview/shared/file-preview-state";
import { MemoryRouter } from "react-router";
const registry = createRegistry();
const register = registry.register.bind(registry);
registerI18n(register);
const nativeRows = new Map<string, DownloadView>();
let revealed = "";
const downloads = createDownloadsService(async () => ({
  browser: {
    listDownloads: async () => [...nativeRows.values()].filter((item) => !item.removed),
    downloadDirectory: async () => "/Users/test/Downloads",
    setDownloadDirectory: async (path) => path,
    publishDownload: async (path, url) => {
      const existing = nativeRows.get(path);
      if (existing) return existing;
      const item = [...items.values()].find((item) => item.path === path)!;
      const row: DownloadView = {
        id: `saved-${item.id}`,
        source: path,
        path: `/Users/test/Downloads/${item.filename}`,
        filename: item.filename,
        url,
        bytes: BigInt(item.receivedBytes),
        createdAt: BigInt(Date.now()),
        removed: false,
      };
      nativeRows.set(path, row);
      return row;
    },
    revealDownload: async (id) => {
      revealed = id;
      return true;
    },
    removeDownload: async (id) => {
      for (const row of nativeRows.values()) if (row.id === id) row.removed = true;
      return true;
    },
  },
}));
registerShell(register, {
  overrides: {
    shell: {
      ...defaultShellService,
      downloads,
      installExplorerResources: (element, t) => installResources(element, t, downloads),
    },
  },
});
const scope = createScope(registry);
const i18n = await scope.getAsync(i18nTokens.i18n);
const installExplorerResources = scope.get(shellTokens.shell).installExplorerResources!;
const toolbar = document.createElement("div");
toolbar.id = "downloads-toolbar";
toolbar.style.cssText = "position:fixed;right:24px;top:160px;z-index:10";
document.body.prepend(toolbar);
const { DownloadsButton } = scope.get(shellTokens.routeRuntime);
const buttonRoot = createRoot(toolbar);
buttonRoot.render(
  createElement(
    ScopeProvider,
    { registry },
    createElement(
      I18nextProvider,
      { i18n: i18n.instance },
      createElement(DownloadsButton, { side: "left" }),
    ),
  ),
);
const items = new Map<number, ExplorerDownload>();
let bytes = "";
let cancelled = 0;
let isLoading = false;
const host = document.querySelector<HTMLElement>("#host")!;
function makeElement() {
  const element = document.createElement("div") as unknown as ExplorerElement;
  element.style.cssText = "width:100%;height:100%;background:#184a70";
  element.getNavigationState = async () => ({ isLoading }) as never;
  element.getDownloads = async () => [...items.values()];
  element.readDownload = async () => bytes;
  element.cancelDownload = async (id) => {
    cancelled = id;
    const item = { ...items.get(id)!, state: "cancelled" as const };
    items.set(id, item);
    element.dispatchEvent(new CustomEvent("download", { detail: item }));
    return true;
  };
  element.pauseDownload = async (id) => {
    const item = { ...items.get(id)!, paused: true, canResume: true };
    items.set(id, item);
    element.dispatchEvent(new CustomEvent("download", { detail: item }));
    return true;
  };
  element.resumeDownload = async (id) => {
    const item = { ...items.get(id)!, paused: false, canResume: false };
    items.set(id, item);
    element.dispatchEvent(new CustomEvent("download", { detail: item }));
    return true;
  };
  host.append(element);
  return element;
}
const officeRequests = new WeakMap<
  HTMLElement,
  (request: { method: string; params: unknown }) => Promise<unknown>
>();
let element = makeElement();
let cleanup = installExplorerResources(element, i18n.instance.t);
Object.assign(window, {
  resourceUiTest: {
    previewState(kind: string) {
      const container = document.createElement("section");
      container.id = "file-state-fixture";
      container.style.height = "100vh";
      document.body.prepend(container);
      const root = createRoot(container);
      if (kind === "pdf")
        root.render(
          createElement(PdfPreview, {
            url: "file:///tmp/document.pdf",
            loadFile: async () => ({
              bytes: new Uint8Array(await (await fetch("/preview.pdf")).arrayBuffer()),
            }),
          }),
        );
      else if (kind === "html" || kind === "html-script")
        root.render(
          createElement(HtmlPreview, {
            url: "fixture.html",
            loadText: async () =>
              kind === "html"
                ? '<!doctype html><html><head><style>h1 { color: rgb(1, 2, 3); }</style></head><body><h1>Safe local preview</h1><script>parent.window.htmlExecuted=true</script><img onerror="parent.window.htmlExecuted=true" src="data:,invalid"><form><input value="form"></form></body></html>'
                : '<html><body><div id="chart"></div><script>throw new Error("unsafe")</script></body></html>',
          }),
        );
      else if (kind === "markdown")
        root.render(
          createElement(MarkdownPreview, {
            url: "file:///tmp/project/README.md",
            resolveSource: localExplorerSource,
            loadText: async () =>
              "# Project notes\n\nMarkdown is **rendered** by default.\n\n- First item\n- Second item\n\n[Other file](./other.md)\n\n```yaml\nname: ovule\n```\n\n" +
              Array.from(
                { length: 100 },
                (_, index) => `Paragraph ${index}. More file content.\n\n`,
              ).join(""),
          }),
        );
      else if (kind === "unsupported")
        root.render(
          createElement(
            MemoryRouter,
            { initialEntries: ["/local-unsupported?url=file:///tmp/project/archive.zip"] },
            createElement(FilePreviewState, { kind: "unsupported", fileName: "archive.zip" }),
          ),
        );
      else
        root.render(
          createElement(CodePreview, {
            url: "file:///tmp/project/npm-lock.yaml",
            language: "yaml",
            loadText: async () => {
              throw new Error("TuffiteError: Local text preview exceeds 2 MiB");
            },
          }),
        );
      Object.assign(container, {
        dispose() {
          root.unmount();
          container.remove();
        },
      });
    },
    async code() {
      const container = document.createElement("section");
      container.id = "local-code-fixture";
      const path = document.createElement("div");
      const frame = document.createElement("iframe");
      frame.style.cssText = "width:650px;height:240px;border:0";
      container.append(path, frame);
      document.body.prepend(container);
      const source = 'const message: string = "<script>literal</script>";\nconsole.log(message);\n';
      frame.contentDocument!.body.style.minHeight = "240px";
      frame.contentDocument!.body.append(document.createElement("pre"));
      frame.contentDocument!.querySelector("pre")!.textContent = source;
      let url = "file:///tmp/My%20Code/src/example.ts";
      const breadcrumbRoot = createRoot(path);
      const render = () =>
        breadcrumbRoot.render(
          createElement(FileBreadcrumbs, {
            address: url,
            loadDirectory: async (directory) => {
              if (directory.endsWith("My%20Code/"))
                return [
                  { name: "src", url: `${directory}src/`, isDirectory: true },
                  { name: "settings.yaml", url: `${directory}settings.yaml`, isDirectory: false },
                ];
              if (directory.endsWith("nested/"))
                return [
                  { name: "config.yaml", url: `${directory}config.yaml`, isDirectory: false },
                ];
              return [
                { name: "nested", url: `${directory}nested/`, isDirectory: true },
                { name: "example.ts", url: `${directory}example.ts`, isDirectory: false },
                { name: "other.yaml", url: `${directory}other.yaml`, isDirectory: false },
              ];
            },
            onNavigate(next) {
              url = next;
              container.dataset.navigated = next;
              container.dataset.source = localExplorerSource(next);
              render();
            },
          }),
        );
      render();
      const codeElement = Object.assign(new EventTarget(), {
        getNavigationState: async () => ({ url, documentId: "code-document", isLoading: false }),
        executeJavaScript: async (script: string) =>
          new Function("document", "location", `return ${script}`)(frame.contentDocument, {
            href: url,
            protocol: "file:",
          }),
      }) as unknown as ExplorerElement;
      const removeCode = installExplorerCode(codeElement);
      Object.assign(container, {
        dispose() {
          removeCode();
          breadcrumbRoot.unmount();
          container.remove();
        },
      });
    },
    yaml() {
      const container = document.createElement("section");
      container.id = "yaml-preview-fixture";
      container.style.height = "100vh";
      document.body.prepend(container);
      const root = createRoot(container);
      root.render(
        createElement(CodePreview, {
          url: "file:///tmp/My%20Code/settings.yaml",
          language: "yaml",
          loadText: async () =>
            "name: ovule\nenabled: true\nitems:\n  - local files\n" +
            Array.from(
              { length: 150 },
              (_, index) => `item_${index}: ${"long content ".repeat(20)}\n`,
            ).join(""),
        }),
      );
      Object.assign(container, {
        dispose() {
          root.unmount();
          container.remove();
        },
      });
    },
    async office(extension: string) {
      const sample = extension === "sample";
      if (sample) extension = "xlsx";
      if (!customElements.get("ovule-office-editor")) {
        Object.assign(globalThis, {
          tuffite: {
            isolated: {
              customElements,
              context: (element: HTMLElement) => ({
                request: async (method: string, params: unknown) =>
                  officeRequests.get(element)?.({ method, params }) ?? null,
              }),
            },
          },
        });
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "/office-ui.js";
          script.onload = () => resolve();
          script.onerror = reject;
          document.head.append(script);
        });
      }
      const container = document.createElement("section");
      container.id = "office-preview-fixture";
      container.style.height = "100vh";
      document.body.prepend(container);
      const root = createRoot(container);
      const readFile = async () => ({
        name: `fixture.${extension}`,
        extension,
        bytes: new Uint8Array(
          await (await fetch(`/fixture.${sample ? "sample." : ""}${extension}`)).arrayBuffer(),
        ),
      });
      const mount: MountIsolated = async (host, _extension, tag, _properties, onRequest) => {
        const shadow = host.attachShadow({ mode: "open" });
        const element = document.createElement(tag);
        if (onRequest)
          officeRequests.set(element, async (request) =>
            onRequest({ ...request, signal: new AbortController().signal }),
          );
        shadow.append(element);
        return {
          update: async (value) => {
            Object.assign(element, value);
          },
          dispose: async () => {
            element.remove();
          },
        };
      };
      root.render(
        createElement(
          I18nextProvider,
          { i18n: i18n.instance },
          createElement(OfficePreview, {
            url: `file:///tmp/fixture.${extension}`,
            readFile,
            mount,
            editor: {
              extensionId: "io.ovule.visuals",
              extensions: [extension],
              tag: "ovule-office-editor",
            },
          }),
        ),
      );
      Object.assign(container, {
        dispose() {
          root.unmount();
          container.remove();
        },
      });
    },
    update(item: ExplorerDownload) {
      items.set(item.id, item);
      element.dispatchEvent(new CustomEvent("download", { detail: item }));
    },
    data(value: string) {
      bytes = value;
    },
    cancelled: () => cancelled,
    revealed: () => revealed,
    transfer() {
      cleanup();
      element.remove();
      element = makeElement();
      cleanup = installExplorerResources(element, i18n.instance.t);
      element.dispatchEvent(new Event("attached"));
    },
    loading(type: string) {
      isLoading = type === "loadstart";
      element.dispatchEvent(new Event(type));
    },
    control() {
      element.dispatchEvent(
        new CustomEvent("ovule:control-activity", { detail: { x: 40, y: 50 } }),
      );
    },
    navigate(url: string) {
      element.dispatchEvent(new CustomEvent("loadcommit", { detail: { url } }));
    },
    dispose() {
      cleanup();
      buttonRoot.unmount();
    },
  },
});
