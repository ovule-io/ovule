import type { GoalView, NodeView, AttemptView, ThreadMessageView } from "@ovule/shell-api";
import type { ViewData } from "@ovule/conversation/view-data";
import type { WorkspaceOperation } from "@ovule/workspace/operations";
import type { ThreadView } from "@ovule/shell-api";
export interface RouteRuntime {
  useConversationProjection: (
    arg0: ViewData | undefined,
    arg1: string | undefined,
    arg2: string | undefined,
    arg3?: boolean,
  ) => ConversationProjection;
  useThreadDraft: (
    arg0: ThreadView | undefined,
    arg1: (operation: WorkspaceOperation) => Promise<boolean>,
    arg2: () => void,
    arg3?: (title: string) => Promise<string | undefined>,
  ) => ThreadDraft;
}
export type ConversationProjection = {
  thread?: ThreadView;
  goal?: GoalView;
  goals: GoalView[];
  nodes: NodeView[];
  attempts: AttemptView[];
  workflowNodes: NodeView[];
  workflowAttempts: AttemptView[];
  messages: ThreadMessageView[];
  threadAttempts: AttemptView[];
  visibleThreads: ThreadView[];
  nodeThread?: NodeView;
};
export type ThreadDraft = {
  workspacePath: string;
  setWorkspacePath(value: string): void;
  choosingWorkspace: boolean;
  interactionError?: string;
  chooseWorkspace(): Promise<string | undefined>;
  clearWorkspace(): void;
  openNewThread(): void;
};
