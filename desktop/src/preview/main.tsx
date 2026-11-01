import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PreviewInfo } from "@ovule/shell-api";
import { preview } from "@ovule/shell-api";
import { mountIsolated } from "./runtime";
import { applyPreviewViewport } from "./viewport";
import { fileCodeLanguage } from "@ovule/file-types";
import { FilePreviewState, filePreviewName } from "./shared/file-preview-state";
import "@fontsource-variable/geist";
import "@ovule/ui/theme.css";
import "./styles.css";

const Html = lazy(() =>
  import("./html/preview").then((module) => ({ default: module.HtmlPreview })),
);
const Image = lazy(() =>
  import("./image/preview").then((module) => ({ default: module.ImagePreview })),
);
const Code = lazy(() =>
  import("./code/preview").then((module) => ({ default: module.CodePreview })),
);
const Markdown = lazy(() =>
  import("./markdown/preview").then((module) => ({ default: module.MarkdownPreview })),
);
const Pdf = lazy(() => import("./pdf/preview").then((module) => ({ default: module.PdfPreview })));
const Office = lazy(() =>
  import("./office/preview").then((module) => ({ default: module.OfficePreview })),
);
const id = location.hostname.match(/^([a-f0-9]{48})\.local$/)?.[1] ?? "";
const readText = () => preview.readText(id);
const readFile = () => preview.readFile(id);
const params = new URLSearchParams(location.search);
function applyAppearance(theme: unknown, language: unknown) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }
  if (language === "en" || language === "zh-CN") document.documentElement.lang = language;
}
applyAppearance(params.get("theme"), params.get("language"));
applyPreviewViewport(Number(params.get("width")), Number(params.get("height")));
// The native host synchronizes appearance and measured pane dimensions.
const bridge = (
  globalThis as typeof globalThis & { tuffite?: import("@ovule/shell/explorer").TuffiteMessageApi }
).tuffite;
bridge?.addEventListener("message", (event) => {
  if (event.origin !== "ovule://-" && !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)) return;
  const message = event.data as {
    type?: string;
    theme?: unknown;
    language?: unknown;
    width?: unknown;
    height?: unknown;
  };
  if (message?.type === "appearance.sync") applyAppearance(message.theme, message.language);
  if (message?.type === "preview.viewport") applyPreviewViewport(message.width, message.height);
});

function PreviewApp() {
  const [info, setInfo] = useState<PreviewInfo>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!id) {
      setError("Invalid local preview grant");
      return;
    }
    void preview
      .describe(id)
      .then((value) => {
        // URL parameters and pathname are display-only; the host grant owns the renderer and file.
        document.title = filePreviewName(value.url) ?? "Local file";
        setInfo(value);
      })
      .catch((error) => setError(String(error)));
  }, []);
  if (error) return <FilePreviewState error={error} />;
  if (!info) return <FilePreviewState kind="loading" />;

  const source = params.get("mode") === "source";
  if (source && ["html", "markdown", "image"].includes(info.kind))
    return (
      <Code
        url={info.url}
        language={info.kind === "html" ? "html" : info.kind === "markdown" ? "markdown" : "xml"}
        loadText={readText}
      />
    );
  if (info.kind === "html") return <Html url={info.url} loadText={readText} />;
  if (info.kind === "image") return <Image url={info.url} loadFile={readFile} />;
  if (info.kind === "code")
    return <Code url={info.url} language={fileCodeLanguage(info.url)} loadText={readText} />;
  // Relative links remain file URLs: the host receives navigation and issues a fresh grant.
  if (info.kind === "markdown")
    return (
      <Markdown
        url={info.url}
        loadText={readText}
        resolveSource={(target) => {
          if (!target.startsWith("file:")) return target;
          const link = new URL("/navigate", location.href);
          link.searchParams.set("url", target);
          return link.href;
        }}
      />
    );
  if (info.kind === "pdf") return <Pdf url={info.url} loadFile={readFile} />;
  if (info.kind === "office")
    return (
      <Office
        url={info.url}
        readFile={readFile}
        editor={info.editor ?? undefined}
        mount={mountIsolated}
      />
    );
  return <FilePreviewState kind="unsupported" fileName={filePreviewName(info.url)} />;
}

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<FilePreviewState kind="loading" />}>
    <PreviewApp />
  </Suspense>,
);
