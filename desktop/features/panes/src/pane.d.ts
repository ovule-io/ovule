import type { ViewData } from "./view-data";
import type { ComponentType, ReactNode } from "react";
import type { WorkspaceOperation } from "./operations";
import type { GoalView, NodeView, ThreadView } from "@ovule/shell-api";

export type PaneContext = {
  id: string;
  target?: string;
  workspaceBindingId?: string;
  useThreadWorkspace: boolean;
  requestVersion: number;
  thread?: ThreadView;
  goal?: GoalView;
  nodes: NodeView[];
  invoke(operation: WorkspaceOperation): Promise<boolean>;
  snapshot: ViewData;
  busy: boolean;
  openNodeThread(threadId: string): void;
};

export type PaneToolbarContext = {
  tab: import("./tab").PaneInstance;
  command(action: string): void;
};

export type WorkspaceToolbarContext = PaneToolbarContext & {
  startEditing(): void;
  copyAddress(): Promise<boolean> | boolean;
  editing: boolean;
  addressEditor: ReactNode;
  downloads: ReactNode;
};

export type PaneDefinition = {
  kind: string;
  component: ComponentType<PaneContext>;
  workspaceToolbar?: ComponentType<WorkspaceToolbarContext>;
  workbenchToolbar?: ComponentType<PaneToolbarContext>;
};

export interface PaneRegistry {
  register(definition: PaneDefinition): () => void;
  resolve(kind?: string | null): PaneDefinition;
  list(): readonly PaneDefinition[];
}
