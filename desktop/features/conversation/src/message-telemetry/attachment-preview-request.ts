import type { AttachmentPreviewRequest } from "@ovule/message-parts/message-parts";

/** Only stable image references cross WebContents; child blob URLs never do. */
export function attachmentPreviewRequest(value: unknown): AttachmentPreviewRequest | undefined {
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  if (input.kind !== "image-preview" || typeof input.url !== "string") return;
  try {
    const url = new URL(input.url);
    if (
      !["http:", "https:"].includes(url.protocol) &&
      !/^ovule-attachment:\/\/\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(input.url)
    )
      return;
  } catch {
    return;
  }
  return {
    kind: "image-preview",
    url: input.url,
    name: typeof input.name === "string" ? input.name.slice(0, 512) : undefined,
    mediaType:
      typeof input.mediaType === "string" && /^image\/(png|jpeg|gif|webp)$/.test(input.mediaType)
        ? input.mediaType
        : undefined,
    sizeBytes:
      typeof input.sizeBytes === "string" && /^\d{1,12}$/.test(input.sizeBytes)
        ? input.sizeBytes
        : undefined,
  };
}
