import type { ComponentType } from "react";
import type { FileEditorContributionView, MessagePartView } from "@ovule/shell-api";
import type {
  MessagePartRendererProps,
  MessagePartRenderer,
  MessagePresentationRegistry,
} from "./message-list";

export function createMessagePresentationRegistry(): MessagePresentationRegistry {
  let revision = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    revision += 1;
    listeners.forEach((listener) => listener());
  };
  const renderers = new Map<string, MessagePartRenderer>();
  const fileEditors = new Map<string, FileEditorContributionView>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    registerRenderer(kind, renderer) {
      renderers.set(kind, renderer);
      changed();
      return () => {
        if (renderers.get(kind) === renderer) {
          renderers.delete(kind);
          changed();
        }
      };
    },
    renderer: (kind) => renderers.get(kind),
    replaceFileEditors(contributions) {
      fileEditors.clear();
      contributions.forEach((contribution) =>
        contribution.extensions.forEach((extension) =>
          fileEditors.set(extension.toLowerCase(), contribution),
        ),
      );
    },
    fileEditor(target) {
      const extension = target
        .split(/[?#]/, 1)[0]
        .match(/\.([a-z0-9]+)$/i)?.[1]
        ?.toLowerCase();
      return extension ? fileEditors.get(extension) : undefined;
    },
  };
}
