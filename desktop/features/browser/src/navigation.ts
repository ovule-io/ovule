export type BrowserDestination = { kind: "url" | "preview"; target: string };

export type OmniboxMessages = {
  enterAddress: string;
  credentialsUnsupported: string;
  unsupportedScheme: string;
  invalidSearchUrl: string;
};

export function resolveOmnibox(
  value: string,
  searchUrl: string,
  messages: OmniboxMessages,
): BrowserDestination {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(messages.enterAddress);
  if (/^ovule:\/\/-\/(?:preview-html|local-html)(?:[?#]|$)/i.test(trimmed))
    return { kind: "url", target: new URL(trimmed).href };
  if (/^(?:https?|file):\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.username || url.password) throw new Error(messages.credentialsUnsupported);
    return { kind: "url", target: url.href };
  }
  if (isAbsoluteFilePath(trimmed)) return { kind: "url", target: fileUrl(trimmed) };
  if (looksLikeWorkspaceHtml(trimmed)) return { kind: "preview", target: trimmed };
  if (looksLikeHost(trimmed)) {
    const scheme = /^(?:localhost|127\.|\[::1\])/i.test(trimmed) ? "http" : "https";
    return { kind: "url", target: new URL(`${scheme}://${trimmed}`).href };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const url = new URL(trimmed);
    if (
      /^(?:javascript|vbscript|data|blob|filesystem|about|chrome(?:-untrusted|-extension)?|devtools|view-source|shell|ms-msdt|search-ms|ovule):$/i.test(
        url.protocol,
      )
    )
      throw new Error(messages.unsupportedScheme);
    if (url.username || url.password) throw new Error(messages.credentialsUnsupported);
    return { kind: "url", target: url.href };
  }
  if (!/^https?:\/\//i.test(searchUrl)) throw new Error(messages.invalidSearchUrl);
  return { kind: "url", target: `${searchUrl}${encodeURIComponent(trimmed)}` };
}

function looksLikeWorkspaceHtml(value: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    (/^\.{0,2}[\\/]/.test(value) || /\.html?(?:[?#].*)?$/i.test(value))
  );
}

function isAbsoluteFilePath(value: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value);
}

function fileUrl(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("//")) return new URL(`file:${normalized}`).href;
  return new URL(/^[a-z]:\//i.test(normalized) ? `/${normalized}` : normalized, "file:///").href;
}

function looksLikeHost(value: string): boolean {
  return (
    !/\s/.test(value) &&
    /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[::1\]|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(
      value,
    )
  );
}
