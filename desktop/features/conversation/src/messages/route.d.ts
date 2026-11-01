import type { WorkflowPresentation } from "@ovule/workflow/presentation/workflow-presentation";
import type { MessagePartsRuntime } from "@ovule/message-parts/message-parts";
import type { ReactNode } from "react";
import type {
  AttemptView,
  GoalView,
  NodeView,
  ThreadMessageView,
  ThreadView,
} from "@ovule/shell-api";
export interface RouteRuntime {
  ActiveWorkflowCard: WorkflowPresentation["ActiveCard"];
  workflowSetupThread: WorkflowPresentation["setupThread"];
  MessageList: (arg0: {
    workflowNodeThread?: boolean;
    thread?: ThreadView;
    goals: GoalView[];
    workflowNodes: NodeView[];
    workflowAttempts: AttemptView[];
    messages: ThreadMessageView[];
    busy: boolean;
    error?: string;
    showMessageTelemetry(messageId: string): Promise<void>;
    openNodeThread(threadId: string): void;
    openWorkflow(goalId: string): void;
    onCompose?(prompt: string): void;
    onFork?(messageId: string): Promise<boolean>;
    onRestart?(messageId: string, content: string): Promise<boolean>;
    onResolveGate?(nodeId: string, approved: boolean): Promise<boolean>;
  }) => ReactNode;
  initializeExtensionMessageBlocks: MessagePartsRuntime["initialize"];
  conversationStyles: Readonly<Record<string, string>>;
}
