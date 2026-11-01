import { expect, test } from "bun:test";
import { attachmentPreviewRequest } from "./attachment-preview-request";

test("app previews accept stable image references and sanitize metadata", () => {
  const url = `ovule-attachment:///${"a".repeat(64)}.png`;
  expect(
    attachmentPreviewRequest({
      kind: "image-preview",
      url,
      name: "Screenshot",
      mediaType: "image/png",
      sizeBytes: "7864320",
    }),
  ).toEqual({
    kind: "image-preview",
    url,
    name: "Screenshot",
    mediaType: "image/png",
    sizeBytes: "7864320",
  });
  expect(
    attachmentPreviewRequest({
      kind: "image-preview",
      url: "https://example.test/image.png",
      mediaType: "text/html",
      sizeBytes: "invalid",
    })?.mediaType,
  ).toBeUndefined();
});

test("app previews reject child blob URLs and local executable content", () => {
  for (const url of [
    "blob:https://example.test/id",
    "file:///private/file.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "ovule-attachment:///../private.png",
    `ovule-attachment:///${"a".repeat(64)}.svg`,
  ]) {
    expect(attachmentPreviewRequest({ kind: "image-preview", url })).toBeUndefined();
  }
  expect(
    attachmentPreviewRequest({ kind: "message-telemetry", url: "https://example.test/image.png" }),
  ).toBeUndefined();
});
