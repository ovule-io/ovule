export type ComposerAttachment = {
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  bytes: Uint8Array;
  previewUrl: string;
};

export type ComposerState = {
  text: string;
  attachments: ComposerAttachment[];
  attachmentError?: string;
};

export interface ComposerService {
  current(): ComposerState;
  subscribe(listener: () => void): () => void;
  setText(value: string): void;
  addImages(files: File[]): Promise<void>;
  removeAttachment(id: string): void;
  clearAttachments(): void;
  selectContext(id: string): void;
  clear(contextId?: string): void;
}
