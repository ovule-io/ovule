import "./file-preview-state.css";
import { FileQuestion, FileWarning, LoaderCircle } from "lucide-react";

export function filePreviewName(address: string): string | undefined {
  try {
    return decodeURIComponent(new URL(address).pathname.split("/").at(-1) || "") || undefined;
  } catch {
    return address.split(/[\\/]/).at(-1) || undefined;
  }
}

export function FilePreviewState({
  kind = "error",
  error = "",
  fileName,
}: {
  kind?: "loading" | "unsupported" | "error";
  error?: string;
  fileName?: string;
}) {
  const limit = error.match(/exceeds\s+(\d+(?:\.\d+)?\s*(?:MiB|MB))/i)?.[1];
  const unsupported = kind === "unsupported" || /binary files|unsupported/i.test(error);
  const loading = kind === "loading";
  const title = loading
    ? "Opening file…"
    : limit
      ? "File is too large to preview"
      : unsupported
        ? "Preview unavailable"
        : "Unable to open this file";
  const description = loading
    ? ""
    : limit
      ? `This file exceeds the ${limit} preview limit.`
      : unsupported
        ? "This file format is not supported for preview."
        : /UTF-8/i.test(error)
          ? "This file cannot be displayed as UTF-8 text."
          : "Check that the file still exists and you have permission to read it.";
  const Icon = loading ? LoaderCircle : unsupported ? FileQuestion : FileWarning;
  return (
    <main className="file-preview-state" role={loading || unsupported ? "status" : "alert"}>
      <div className="file-preview-state-content">
        <span className="file-preview-state-icon">
          <Icon size={26} className={loading ? "file-preview-state-spin" : undefined} />
        </span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {fileName && <span className="file-preview-state-name">{fileName}</span>}
      </div>
    </main>
  );
}
