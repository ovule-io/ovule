import "./preview.css";
import { useEffect, useRef, useState } from "react";
import type { MountIsolated, IsolatedView } from "@ovule/shell/isolated";
import { FilePreviewState, filePreviewName } from "../shared/file-preview-state";

type OfficePreviewProps = {
  url: string;
  readFile(): Promise<{ name: string; extension: string; bytes: Uint8Array | number[] }>;
  editor?: Pick<
    import("@ovule/shell-api").FileEditorContributionView,
    "extensionId" | "extensions" | "tag"
  >;
  mount: MountIsolated;
};

export function OfficePreview({ url, readFile, editor, mount }: OfficePreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    window.document.title = filePreviewName(url) ?? "Local file";
    let view: IsolatedView | undefined;
    let renderError: string | undefined;
    setError(undefined);
    setReady(false);
    void (async () => {
      try {
        const file = await readFile();
        if (!active || !host.current) return;
        if (!editor) throw new Error(`Unsupported Office format: ${file.extension}`);
        if (!editor.extensions.includes(file.extension))
          throw new Error(`Unsupported Office format: ${file.extension}`);
        view = await mount(host.current, editor.extensionId, editor.tag, {}, async (request) => {
          if (!active || renderError) return null;
          if (request.method === "file.previewReady") setReady(true);
          if (request.method === "file.previewError") {
            const message = (request.params as { message?: string } | null)?.message;
            renderError = typeof message === "string" ? message : "Office preview failed";
            setError(renderError);
            const failed = view;
            view = undefined;
            void failed?.dispose().catch(console.error);
          }
          return null;
        });
        if (!active) {
          await view.dispose();
          return;
        }
        for (let offset = 0; offset < file.bytes.length || offset === 0; offset += 32768) {
          if (!active) return;
          const done = offset + 32768 >= file.bytes.length;
          await view.update({
            fileChunk: {
              offset,
              bytes: Array.from(file.bytes.slice(offset, offset + 32768)),
              done,
              ...(done
                ? { metadata: { name: file.name, extension: file.extension, readOnly: true } }
                : {}),
            },
          });
        }
        if (active) {
          window.document.title = file.name;
        }
      } catch (cause) {
        if (active)
          setError(renderError ?? (cause instanceof Error ? cause.message : String(cause)));
        await view?.dispose();
        view = undefined;
      }
    })();
    return () => {
      active = false;
      void view?.dispose();
    };
  }, [url, readFile, editor, mount]);
  if (error) return <FilePreviewState error={error} fileName={filePreviewName(url)} />;
  return (
    <main className="preview-office" data-preview-office-url={url} data-ready={ready}>
      {!ready && (
        <div className="preview-office-loading">
          <FilePreviewState kind="loading" />
        </div>
      )}
      <div ref={host} className="preview-office-host" />
    </main>
  );
}
