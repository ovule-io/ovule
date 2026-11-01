export function safeRemoteUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function safeExtensionAssetUrl(value: string, suffix: string): string | undefined {
  try {
    const url = new URL(value, location.href);
    return url.protocol === location.protocol &&
      url.host === location.host &&
      url.pathname.startsWith("/extensions/") &&
      url.pathname.endsWith(suffix)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatBytes(value?: bigint | null): string | undefined {
  if (value == null) return undefined;
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function attachmentIdFromUrl(value?: string | null): string | undefined {
  if (!value?.startsWith("ovule-attachment:///")) return undefined;
  const id = value.slice("ovule-attachment:///".length);
  return /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(id) ? id : undefined;
}
