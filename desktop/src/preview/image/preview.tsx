import { useEffect, useState } from "react";
import type { PreviewFile } from "@ovule/shell-api";
import { FilePreviewState, filePreviewName } from "../shared/file-preview-state";

/** An SVG in an img remains inert: embedded scripts never run in the preview realm. */
export function ImagePreview({ url, loadFile }: { url: string; loadFile(): Promise<PreviewFile> }) {
  const [result, setResult] = useState<{ url: string; source?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    let source: string | undefined;
    void loadFile()
      .then((file) => {
        if (!active) return;
        source = URL.createObjectURL(
          new Blob([Uint8Array.from(file.bytes)], { type: "image/svg+xml" }),
        );
        setResult({ url, source });
      })
      .catch((error) => {
        if (active) setResult({ url, error: String(error) });
      });
    return () => {
      active = false;
      if (source) URL.revokeObjectURL(source);
    };
  }, [url, loadFile]);
  if (result?.url !== url) return <FilePreviewState kind="loading" />;
  if (result.error)
    return <FilePreviewState error={result.error} fileName={filePreviewName(url)} />;
  return (
    <main className="grid h-full w-full place-items-center overflow-auto p-6" data-preview-image>
      <img
        style={{
          width: "auto",
          height: "auto",
          maxWidth: "min(100%, 320px)",
          maxHeight: "min(70vh, 320px)",
          objectFit: "contain",
        }}
        src={result.source}
        alt={filePreviewName(url) ?? "SVG"}
        onError={() => setResult({ url, error: "Unable to render SVG image" })}
      />
    </main>
  );
}
