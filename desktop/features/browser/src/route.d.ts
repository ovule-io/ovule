import type { NewTabView } from "@ovule/panes/view";
import type { ComponentType, ReactNode } from "react";
import type { LiveExplorerRequest } from "@ovule/framework/overlay/main-overlay";
import type { ExplorerElement } from "@ovule/shell/explorer";
export interface RouteRuntime {
  FileBreadcrumbs: ComponentType<FileBreadcrumbsProps>;
  NewTabPage: NewTabView;
  showExplorerTransferPreview(target: ExplorerElement, preview: string): Promise<() => void>;
  waitForExplorerPaint(target: ExplorerElement): Promise<void>;
  ExplorerOverlay: (arg0: {
    request: LiveExplorerRequest;
    fallbackThreadId?: string;
    fallbackDraftId?: string;
    sidebarAvailable?: boolean;
  }) => ReactNode;
}

export type LocalFileEntry = { name: string; url: string; isDirectory: boolean };
export type DirectoryLoader = (url: string) => Promise<LocalFileEntry[]>;
export type FileBreadcrumbsProps = {
  address: string;
  onNavigate(url: string): void;
  loadDirectory?: DirectoryLoader;
};
