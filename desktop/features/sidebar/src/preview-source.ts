/** Only built-in preview origins can carry a trusted display/navigation source. */
export function previewSourceAddress(value: string): string {
  try {
    const url = new URL(value);
    const grant =
      /^[a-f0-9]{48}\.local$/.test(url.hostname) &&
      ["code", "office", "pdf", "markdown", "html", "unsupported", "navigate"].includes(
        url.pathname.slice(1),
      );
    const legacy =
      url.hostname === "-" &&
      ["/local-code", "/local-office", "/local-markdown", "/local-unsupported"].includes(
        url.pathname,
      );
    if (url.protocol !== "ovule:" || (!grant && !legacy)) return value;
    const source = url.searchParams.get("url");
    if (!source) return value;
    const target = new URL(source);
    if (target.protocol === "file:") return source;
    if (
      target.protocol === "ovule:" &&
      target.host === "-" &&
      ["/preview-html", "/local-html"].includes(target.pathname)
    )
      return source;
  } catch {
    /* Non-URL labels are preserved. */
  }
  return value;
}
