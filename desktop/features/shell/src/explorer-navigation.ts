import type { ExplorerOpenRequest } from "./explorer";

export function explorerOpenDestination(
  type: string,
  request: Pick<ExplorerOpenRequest, "url"> & Partial<Pick<ExplorerOpenRequest, "userGesture">>,
): "ignore" | "current" | "popup" | "overlay" {
  // Internal route changes and script redirects must remain in their owner.
  if (type === "navigation" && /^ovule:/i.test(request.url)) return "current";
  if (!/^(?:https?|file):\/\//i.test(request.url)) return "ignore";
  if (type === "navigation" && !request.userGesture) return "current";
  if (type === "popup" && /^https?:\/\//i.test(request.url)) return "popup";
  return "overlay";
}

export function resolveBrowserTarget(
  value?: string,
  searchUrl = "https://www.bing.com/search?q=",
): string {
  const target = value?.trim();
  if (!target) return "about:blank";
  if (/^ovule:\/\/-\/(?:preview|preview-html|local-html)(?:[?#]|$)/i.test(target))
    return new URL(target).href;
  if (/^(?:https?|file):\/\//i.test(target)) return new URL(target).href;
  if (/^(?:localhost|127\.|\[::1\])/i.test(target)) return new URL(`http://${target}`).href;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(target)) return new URL(`https://${target}`).href;
  try {
    const url = new URL(searchUrl);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password)
      return `${searchUrl}${encodeURIComponent(target)}`;
  } catch {
    /* Invalid persisted search URLs fall back to Bing. */
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(target)}`;
}
