export type PaneKind =
  | "workflow"
  | "browser"
  | "handoff"
  | "spice"
  | "files"
  | "markdown"
  | "office"
  | "terminal";

export type PaneInstance = {
  id: string;
  kind: PaneKind;
  title: string;
  placement?: "thread" | "workbench";
  favicon?: string;
  url?: string;
  /** Serializable live pane chrome state, reported by the pane surface. */
  toolbarState?: Record<string, string>;
  canGoBack?: boolean;
  canGoForward?: boolean;
  ordinal?: number;
  /** Persisted monotonic visit order, independent of sidebar ordering. */
  lastVisited?: number;
  threadId?: string;
  draftId?: string;
  workspaceBindingId?: string;
  shellProfileId?: string;
  useThreadWorkspace?: boolean;
  target?: string;
  autoLoad?: boolean;
  navigation?: "emit" | "allow";
  requestVersion: number;
};
