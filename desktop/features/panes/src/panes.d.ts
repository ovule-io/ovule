import type { PaneInstance, PaneKind } from "@ovule/panes/tab";

export type OpenPaneOptions = {
  /** Replace this pane only while it is still a blank New Tab. */
  replaceBlankId?: string;
  placement?: "thread" | "workbench";
  newInstance?: boolean;
  reuseExistingTarget?: boolean;
  target?: string;
  autoLoad?: boolean;
  navigation?: "emit" | "allow";
  threadId?: string;
  draftId?: string;
  workspaceBindingId?: string;
  shellProfileId?: string;
  useThreadWorkspace?: boolean;
};

export type PanesState = {
  draftConversationId: string;
  activeThreadArtifacts: Record<string, string | undefined>;
  instances: PaneInstance[];
  activeWorkbenchPaneId?: string;
};

export interface PanesService {
  current(): PanesState;
  subscribe(listener: () => void): () => void;
  bindDraftToThread(draftId: string, threadId: string): void;
  selectThreadArtifact(threadId: string, id?: string): void;
  moveTabToWorkbench(id: string): void;
  updateTab(
    id: string,
    values: Partial<
      Pick<
        PaneInstance,
        | "title"
        | "url"
        | "favicon"
        | "target"
        | "requestVersion"
        | "canGoBack"
        | "canGoForward"
        | "toolbarState"
      >
    >,
  ): void;
  openTab(kind: PaneKind, options?: OpenPaneOptions): string;
  selectTab(id: string): void;
  closeTab(id: string): void;
}
