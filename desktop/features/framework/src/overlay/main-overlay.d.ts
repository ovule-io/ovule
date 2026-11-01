import type { BrowserAgentBinding } from "@ovule/shell/explorer";
export type ExplorerOverlayRequest = {
  target: string;
  agent?: BrowserAgentBinding;
  threadId?: string;
  navigation?: "allow" | "emit";
};

export type LiveExplorerRequest = ExplorerOverlayRequest & { id: string };

export type MainOverlayState = {
  explorerTabs: Record<string, LiveExplorerRequest>;
  explorer?: LiveExplorerRequest;
  settingsOpen: boolean;
  remoteWorkspacesOpen: boolean;
  onboardingRequested: boolean;
  threadSwitcherOpen: boolean;
};

export interface MainOverlayService {
  openExplorer(request: ExplorerOverlayRequest): void;
  closeExplorer(): void;
  promoteExplorer(tabId: string): void;
  releaseExplorerTab(tabId: string): void;
  current(): MainOverlayState;
  subscribe(listener: () => void): () => void;
  open(target: "settings" | "remoteWorkspaces" | "onboarding" | "threadSwitcher"): void;
  close(target: "settings" | "remoteWorkspaces" | "onboarding" | "threadSwitcher"): void;
}
