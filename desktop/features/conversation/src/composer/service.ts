import { create } from "zustand";

import type { ComposerAttachment, ComposerService, ComposerState } from "./composer";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function createComposerService(): ComposerService {
  const store = create<ComposerState>(() => ({ text: "", attachments: [] }));
  let contextId = "";
  const drafts = new Map<string, ComposerState>();
  const clearAttachments = () => {
    for (const attachment of store.getState().attachments)
      URL.revokeObjectURL(attachment.previewUrl);
    store.setState({ attachments: [], attachmentError: undefined });
  };
  return {
    current: store.getState,
    subscribe: (listener) => store.subscribe(listener),
    setText: (text) => store.setState({ text }),
    async addImages(files) {
      const { attachments } = store.getState();
      store.setState({ attachmentError: undefined });
      if (attachments.length + files.length > MAX_IMAGES) {
        store.setState({ attachmentError: "tooManyImages" });
        return;
      }
      if (files.some((file) => !SUPPORTED_IMAGE_TYPES.has(file.type))) {
        store.setState({ attachmentError: "unsupportedImage" });
        return;
      }
      if (files.some((file) => file.size > MAX_IMAGE_BYTES)) {
        store.setState({ attachmentError: "imageTooLarge" });
        return;
      }
      const existingBytes = attachments.reduce((total, image) => total + image.sizeBytes, 0);
      if (
        existingBytes + files.reduce((total, file) => total + file.size, 0) >
        MAX_IMAGE_TOTAL_BYTES
      ) {
        store.setState({ attachmentError: "imagesTooLarge" });
        return;
      }
      const additions = await Promise.all(
        files.map(
          async (file, index): Promise<ComposerAttachment> => ({
            id: `${Date.now()}-${index}-${crypto.randomUUID()}`,
            name: file.name || `pasted-image-${attachments.length + index + 1}`,
            mediaType: file.type,
            sizeBytes: file.size,
            bytes: new Uint8Array(await file.arrayBuffer()),
            previewUrl: URL.createObjectURL(file),
          }),
        ),
      );
      store.setState((state) => ({
        attachments: [...state.attachments, ...additions],
      }));
    },
    removeAttachment(id) {
      const removed = store.getState().attachments.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      store.setState((state) => ({
        attachments: state.attachments.filter((image) => image.id !== id),
        attachmentError: undefined,
      }));
    },
    clearAttachments,
    selectContext(id) {
      if (id === contextId) return;
      drafts.set(contextId, store.getState());
      contextId = id;
      store.setState(
        drafts.get(id) ?? {
          text: "",
          attachments: [],
          attachmentError: undefined,
        },
        true,
      );
    },
    clear(id = contextId) {
      if (id === contextId) {
        clearAttachments();
        store.setState({ text: "" });
      } else {
        for (const attachment of drafts.get(id)?.attachments ?? [])
          URL.revokeObjectURL(attachment.previewUrl);
      }
      drafts.delete(id);
    },
  };
}
