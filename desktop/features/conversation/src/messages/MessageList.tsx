import { TurnContext } from "./TurnContext";
import { messageNotice } from "./message-notice";
import { useEffect, useMemo, useState } from "react";
import {
  HISTORY_BATCH_SIZE,
  VirtualMessageHistory,
  VirtualMessageTurn,
} from "./VirtualMessageHistory";
import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import shellTokens from "@ovule/shell/shell.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import { ArrowDown, Plus, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useService } from "@ovule/ioc/react";

import { Reasoning } from "@ovule/ui/reasoning";
import { ConversationMessage } from "./ConversationMessage";
import { buildConversationTimeline } from "./timeline";
import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@ovule/ui/message";
import type {
  AttemptView,
  GoalView,
  NodeView,
  ThreadMessageView,
  ThreadView,
} from "@ovule/shell-api";
import conversationStyles from "./ConversationPane.module.css";

function MessageListContent({
  thread,
  goals,
  workflowNodes,
  workflowAttempts,
  messages,
  busy,
  error,
  showMessageTelemetry,
  openNodeThread,
  openWorkflow,
  onCompose,
  onFork,
  onRestart,
  onResolveGate,
  workflowNodeThread = false,
}: {
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
}) {
  const { t } = useTranslation();
  const Approvals = useService(shellTokens.shell).agentApprovals?.View;
  const { View: MessageParts } = useService(messagePartsTokens.runtime);
  const { Graph: WorkflowGraphCard } = useService(workflowTokens.presentation);
  const statusMessageId = messages[messages.length - 1]?.id;
  const timeline = useMemo(
    () => buildConversationTimeline(messages, workflowNodeThread ? [] : goals),
    [messages, goals, workflowNodeThread],
  );
  const [start, setStart] = useState(() => Math.max(0, timeline.length - HISTORY_BATCH_SIZE));
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const historyStart = Math.min(start, Math.max(0, timeline.length - HISTORY_BATCH_SIZE));
  useEffect(() => {
    if (!viewport || !sentinel || historyStart === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setStart((value) => Math.max(0, value - HISTORY_BATCH_SIZE));
      },
      { root: viewport, rootMargin: "240px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewport, sentinel, historyStart]);
  return (
    <MessageScrollerProvider
      key={thread?.id ?? "empty"}
      autoScroll
      defaultScrollPosition="end"
      scrollPreviousItemPeek={24}
    >
      <MessageScroller
        className={cn("timeline", conversationStyles.timeline)}
        data-testid="thread-timeline"
      >
        <TurnContext viewport={viewport} messages={messages} />
        <MessageScrollerViewport
          ref={setViewport}
          className={cn(
            "scroll-fade-b scrollbar-thin scrollbar-gutter-stable",
            conversationStyles.messageScrollerViewport,
          )}
        >
          {historyStart > 0 && (
            <div ref={setSentinel} className={conversationStyles.historyLoader}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStart((value) => Math.max(0, value - HISTORY_BATCH_SIZE))}
              >
                {t("conversation.loadEarlier")}
              </Button>
            </div>
          )}
          <MessageScrollerContent aria-busy={busy}>
            <VirtualMessageHistory viewport={viewport}>
              {timeline.slice(historyStart).map((item) =>
                item.kind === "message" ? (
                  <VirtualMessageTurn
                    className={conversationStyles.messageTurn}
                    messageId={item.message.id}
                    streaming={item.message.status === "streaming"}
                    key={item.message.id}
                  >
                    <ConversationMessage
                      role={messageNotice(item.message).cancelled ? "assistant" : item.message.role}
                      status={
                        messageNotice(item.message).cancelled ? "cancelled" : item.message.status
                      }
                      notice={messageNotice(item.message).text}
                      author={
                        item.message.role === "user"
                          ? t("conversation.you")
                          : item.message.role === "assistant"
                            ? (thread?.agent ?? "Ovule")
                            : "Ovule"
                      }
                      createdAt={item.message.createdAt}
                      error={item.message.id === statusMessageId ? error : undefined}
                      onTelemetry={() => void showMessageTelemetry(item.message.id)}
                      prompt={item.message.parts
                        .filter((part) => part.kind === "markdown")
                        .map((part) => part.text ?? "")
                        .join("\n")}
                      onFork={
                        onFork && ["user", "assistant"].includes(item.message.role)
                          ? () => onFork(item.message.id)
                          : undefined
                      }
                      onRestart={
                        item.message.role === "user" && onRestart
                          ? (content) => onRestart(item.message.id, content)
                          : undefined
                      }
                    >
                      {item.message.status === "streaming" &&
                        !item.message.parts.some(
                          (part) => part.text?.trim() || part.kind === "thinking",
                        ) && (
                          <Reasoning running label={t("messageList.thinking")} hasContent={false} />
                        )}
                      <MessageParts
                        parts={messageNotice(item.message).parts.filter(
                          (part) =>
                            part.kind !== "workflow" &&
                            (workflowNodeThread || !part.id.endsWith("setup-status")),
                        )}
                        renderBlocks={item.message.role === "assistant"}
                        streaming={item.message.status === "streaming"}
                        onCompose={onCompose}
                      />
                      {Approvals && item.message.role === "assistant" && item.message.attemptId && (
                        <Approvals
                          attemptId={item.message.attemptId}
                          translate={t}
                          active={item.message.status === "streaming"}
                        />
                      )}
                      {item.workflows.map((goal) => (
                        <WorkflowGraphCard
                          key={goal.id}
                          goal={goal}
                          nodes={workflowNodes.filter((node) => node.goalId === goal.id)}
                          attempts={workflowAttempts.filter((attempt) =>
                            workflowNodes.some(
                              (node) => node.goalId === goal.id && node.id === attempt.taskId,
                            ),
                          )}
                          onResolveGate={onResolveGate}
                          onInspect={() => openWorkflow(goal.id)}
                          onOpenNode={openNodeThread}
                        />
                      ))}
                    </ConversationMessage>
                  </VirtualMessageTurn>
                ) : (
                  <VirtualMessageTurn
                    key={item.goal.id}
                    messageId={`workflow:${item.goal.id}`}
                    className={conversationStyles.messageTurn}
                  >
                    <ConversationMessage role="assistant" author={thread?.agent ?? "Ovule"}>
                      <WorkflowGraphCard
                        key={item.goal.id}
                        goal={item.goal}
                        nodes={workflowNodes.filter((node) => node.goalId === item.goal.id)}
                        attempts={workflowAttempts.filter((attempt) =>
                          workflowNodes.some(
                            (node) => node.goalId === item.goal.id && node.id === attempt.taskId,
                          ),
                        )}
                        onResolveGate={onResolveGate}
                        onInspect={() => openWorkflow(item.goal.id)}
                        onOpenNode={openNodeThread}
                      />
                    </ConversationMessage>
                  </VirtualMessageTurn>
                ),
              )}
            </VirtualMessageHistory>
            {error && !statusMessageId && (
              <div role="alert" className={conversationStyles.messageError}>
                {error}
              </div>
            )}
            {!thread ? (
              <section className={conversationStyles.emptyGoal}>
                <Workflow size={30} />
                <h2 className={conversationStyles.emptyGoalTitle}>
                  {t("conversation.startWorkspace")}
                </h2>
                <p className={conversationStyles.emptyGoalDescription}>
                  {t("conversation.workspaceHelp")}
                </p>
                <Button size="sm" variant="secondary" disabled>
                  <Plus size={14} /> {t("conversation.createGoal")}
                </Button>
              </section>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton
          className={conversationStyles.messageScrollToBottom}
          aria-label={t("conversation.scrollToLatest")}
          title={t("conversation.scrollToLatest")}
        >
          <ArrowDown size={18} />
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

// A new conversation starts with a fresh, small tail and its own scroll state.
export function MessageList(props: Parameters<typeof MessageListContent>[0]) {
  return <MessageListContent key={props.thread?.id ?? "empty"} {...props} />;
}
