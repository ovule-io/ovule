import type { ComponentType } from "react";
import type { FileEditorContributionView, MessagePartView } from "@ovule/shell-api";

export type MessagePartRendererProps = {
  part: MessagePartView;
  streaming: boolean;
  onCompose?(prompt: string): void;
};

export type MessagePartRenderer = ComponentType<MessagePartRendererProps>;

export interface MessagePresentationRegistry {
  subscribe(listener: () => void): () => void;
  revision(): number;
  registerRenderer(kind: string, renderer: MessagePartRenderer): () => void;
  renderer(kind: string): MessagePartRenderer | undefined;
  replaceFileEditors(contributions: readonly FileEditorContributionView[]): void;
  fileEditor(target: string): FileEditorContributionView | undefined;
}
