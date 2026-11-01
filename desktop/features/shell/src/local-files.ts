import { fileCodeLanguage } from "./explorer-code";
export { fileCodeLanguage } from "./explorer-code";

export function localDocumentFile(address: string): boolean {
  try {
    const url = new URL(address);
    return (
      url.protocol === "file:" &&
      /\.(?:pdf|doc|docx|dotx|xlsx|xlsm|csv|pptx|pptm|ppsx)$/i.test(
        decodeURIComponent(url.pathname),
      )
    );
  } catch {
    return false;
  }
}

export function localExplorerSource(address: string, base = location.href): string {
  let file: URL;
  try {
    file = new URL(address);
  } catch {
    return address;
  }
  if (file.protocol !== "file:" || file.pathname.endsWith("/")) return address;
  const office = localDocumentFile(address);
  const markdown = /\.(?:md|markdown|mdown)$/i.test(file.pathname);
  const image = /\.svg$/i.test(file.pathname);
  const code = !image && Boolean(fileCodeLanguage(address));
  if (
    !office &&
    !image &&
    !markdown &&
    !code &&
    (!/\.[^/]+$/.test(file.pathname) ||
      /\.(?:html?|pdf|png|jpe?g|gif|webp|avif|bmp|ico|mp4|webm|og[gv]|mp3|wav|m4a|aac|flac|txt|log)$/i.test(
        file.pathname,
      ))
  )
    return address;
  const url = new URL(
    image
      ? "/local-image"
      : office
        ? "/local-office"
        : markdown
          ? "/local-markdown"
          : code
            ? "/local-code"
            : "/local-unsupported",
    base,
  );
  url.searchParams.set("url", address);
  return url.href;
}

export function localExplorerAddress(address: string, base = location.href): string {
  try {
    const url = new URL(address);
    const origin = new URL(base);
    if (
      ((url.protocol === origin.protocol && url.host === origin.host) ||
        (url.protocol === "ovule:" && /^[a-f0-9]{48}\.local$/.test(url.hostname))) &&
      [
        "/html",
        "/navigate",
        "/pdf",
        "/image",
        "/local-image",
        "/code",
        "/office",
        "/markdown",
        "/unsupported",
        "/local-code",
        "/local-office",
        "/local-markdown",
        "/local-unsupported",
      ].includes(url.pathname)
    ) {
      const source = url.searchParams.get("url");
      if (source && (new URL(source).protocol === "file:" || htmlPreviewRequest(source)))
        return source;
    }
  } catch {
    /* Preserve non-URL labels. */
  }
  return address;
}

export async function listLocalDirectory(url: string) {
  return (await import("@ovule/shell-api")).browser.listLocalDirectory(url);
}

export async function readLocalText(url: string) {
  return (await import("@ovule/shell-api")).browser.readLocalText(url);
}

export async function readLocalFile(url: string) {
  return (await import("@ovule/shell-api")).browser.readLocalFile(url);
}

/** Stable host-side recipe: persisted panes reissue the workspace-scoped grant. */
export function htmlPreviewSource(threadId: string, path: string): string {
  const source = new URL("ovule://-/preview-html");
  source.searchParams.set("thread", threadId);
  source.searchParams.set("path", path);
  return source.href;
}

export function htmlPreviewRequest(
  address: string,
): { threadId: string; path: string } | undefined {
  try {
    const url = new URL(address);
    if (
      url.protocol !== "ovule:" ||
      url.host !== "-" ||
      !["/preview-html", "/local-html"].includes(url.pathname)
    )
      return;
    const threadId = url.searchParams.get("thread");
    const path = url.searchParams.get("path");
    if (threadId && path) return { threadId, path };
  } catch {
    /* Not an internal HTML preview recipe. */
  }
}

export async function revealLocalFile(url: string): Promise<boolean> {
  return (await import("@ovule/shell-api")).browser.revealLocalFile(url);
}
