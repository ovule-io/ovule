import type { BrowserAgentBinding, BrowserAgentMetadata } from "./explorer";
export type BrowserSurfacePresenter = (
  agent: BrowserAgentBinding,
  url: string,
  threadId?: string,
) => void;
import type { TFunction } from "i18next";
import type { DialogApi } from "./dialog";
import type { ExplorerElement, ExplorerOpenRequest, TuffiteMessageApi } from "./explorer";
import type { WindowInfo, WindowApi } from "./window";

export interface ShellService {
  loadExplorer(element: ExplorerElement, address: string, initial?: boolean): void;
  htmlPreviewSource(threadId: string, path: string): string;
  localExplorerAddress(address: string): string;
  fileCodeLanguage(address: string): string | undefined;
  listLocalDirectory(url: string): Promise<{ name: string; url: string; isDirectory: boolean }[]>;
  revealLocalFile?(url: string): Promise<boolean>;
  readLocalText(url: string): Promise<string>;
  readLocalFile(url: string): Promise<import("@ovule/shell-api").WorkspaceFile>;
  downloads?: import("./downloads").DownloadsService;
  mountIsolated: import("./isolated-api").MountIsolated;
  installAgentApprovals?(): () => void;
  agentApprovals?: {
    ModePicker?: import("react").ComponentType<{ translate: TFunction }>;
    View: import("react").ComponentType<{
      attemptId: string;
      translate: TFunction;
      active?: boolean;
    }>;
  };
  installBrowserControl?(present?: BrowserSurfacePresenter): () => void;
  installAgentBrowserControls?(
    host: HTMLElement,
    agent: BrowserAgentBinding,
    translate: TFunction,
  ): () => void;
  receiveBrowserAgent?(
    port: MessagePort,
    metadata: BrowserAgentMetadata,
    element: ExplorerElement,
    closeSurface: () => void,
  ): BrowserAgentBinding;
  installDesktopControlFeedback?(): () => void;
  installExplorerResources?(element: ExplorerElement, translate: TFunction): () => void;
  copyText(value: string): Promise<boolean>;
  openPopupWindow(url: string): Promise<WindowInfo>;
  windowApi(): Promise<WindowApi>;
  workspaceRelativePath(workspacePath: string, selectedPath: string): string | undefined;
  workspaceCandidatePath(workspacePath: string, value: string): string;
  explorerOpenDestination(
    type: string,
    request: Pick<ExplorerOpenRequest, "url"> & Partial<Pick<ExplorerOpenRequest, "userGesture">>,
  ): "ignore" | "current" | "popup" | "overlay";
  resolveBrowserTarget(value?: string): string;
  surfaceUrl(
    path: "/main" | "/thread" | "/pane" | "/explorer",
    values?: Record<string, string | undefined>,
  ): string;
  navigateSurface(url: string): void;
  loadExternalModule(value: string): Promise<unknown>;
  readonly native: boolean;
  readonly macOS: boolean;
  dialog(): Promise<DialogApi>;
  window(): Promise<WindowApi>;
  messageApi(): TuffiteMessageApi | undefined;
  requestRoot<T>(channel: string, payload: unknown): Promise<T>;
}
