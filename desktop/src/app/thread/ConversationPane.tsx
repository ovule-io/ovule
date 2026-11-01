import panesTokens from "@ovule/panes/panes.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import { useService } from "@ovule/ioc/react";

import { Textarea } from "@ovule/ui/form";
import { Monitor, PanelLeft, Plus, Workflow, X } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@ovule/ui/surface";
import { Tooltip } from "@ovule/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import type { WorkspaceOperation } from "@ovule/shell/snapshot-sync";
import type {
  AgentView,
  AttemptView,
  GoalView,
  HostView,
  HostWorkspaceResource,
  NodeView,
  ModelView,
  RemoteEndpointView,
  SkillView,
  ThreadMessageView,
  ThreadView,
  WorkspaceBindingView,
} from "@ovule/shell-api";
import type { PaneInstance, PaneKind } from "@ovule/panes/tab";
import type { MessageImageDraft } from "@ovule/conversation/composer/message-draft";
import { cn } from "@ovule/ui/cn";

export function ConversationPane({
  thread,
  goals,
  nodeThread,
  workflowNodes,
  workflowAttempts,
  messages,
  threadAttempts,
  agents,
  hosts,
  models,
  snapshotRevision,
  skills,
  busy,
  error,
  newGoal,
  setNewGoal,
  goalPrompt,
  setGoalPrompt,
  creatingGoal,
  prepareGoal,
  createGoal,
  messageText,
  setMessageText,
  messageImages,
  attachmentError,
  addPastedImages,
  removeMessageImage,
  sendingMessage,
  sendMessage,
  workspacePath,
  clearWorkspace,
  choosingWorkspace,
  chooseWorkspace,
  openTool,
  openMessageTelemetry,
  invoke,
  sidebarOpen,
  onToggleSidebar,
  workspaceBindings,
  remoteHosts,
  openHosts,
  addLocalWorkspace,
  addRemoteWorkspace,
  draftAgentId,
  setDraftAgentId,
  draftHostId,
  setDraftHostId,
  threadTabs,
  selectTab,
  selectThread,
  hasLegacyWorkflowData,
}: {
  thread?: ThreadView;
  goals: GoalView[];
  nodeThread?: NodeView;
  workflowNodes: NodeView[];
  workflowAttempts: AttemptView[];
  messages: ThreadMessageView[];
  threadAttempts: AttemptView[];
  agents: AgentView[];
  hosts: HostView[];
  models: ModelView[];
  snapshotRevision: bigint;
  skills: SkillView[];
  busy: boolean;
  error?: string;
  newGoal: boolean;
  setNewGoal(value: boolean): void;
  goalPrompt: string;
  setGoalPrompt(value: string): void;
  creatingGoal: boolean;
  prepareGoal(): Promise<void>;
  createGoal(): Promise<void>;
  messageText: string;
  setMessageText(value: string): void;
  messageImages: MessageImageDraft[];
  attachmentError?: string;
  addPastedImages(files: File[]): Promise<void>;
  removeMessageImage(id: string): void;
  sendingMessage: boolean;
  sendMessage(): Promise<void>;
  workspacePath: string;
  clearWorkspace(): void;
  choosingWorkspace: boolean;
  chooseWorkspace(): Promise<string | undefined>;
  openTool(kind: PaneKind, newInstance?: boolean, target?: string): string;
  openMessageTelemetry?(messageId: string): Promise<boolean>;
  invoke(operation: WorkspaceOperation): Promise<boolean>;
  sidebarOpen: boolean;
  onToggleSidebar(): void;
  workspaceBindings: WorkspaceBindingView[];
  remoteHosts: RemoteEndpointView[];
  openHosts(): void;
  addLocalWorkspace(): Promise<void>;
  addRemoteWorkspace(endpoint: RemoteEndpointView, resource: HostWorkspaceResource): Promise<void>;
  draftAgentId: string;
  setDraftAgentId(value: string): void;
  draftHostId: string;
  setDraftHostId(value: string): void;
  threadTabs: PaneInstance[];
  selectTab(tabId: string): void;
  selectThread(threadId: string): void;
  hasLegacyWorkflowData: boolean;
}) {
  const { PaneToolbarFrame, titlebarStyles } = useService(panesTokens.routeRuntime);
  const { MessageTelemetryDialog } = useService(conversationTokens.messageTelemetryRouteRuntime);
  const { ActiveWorkflowCard, workflowSetupThread, MessageList, conversationStyles } = useService(
    conversationTokens.messageRouteRuntime,
  );
  const { MessageComposer } = useService(conversationTokens.composerRouteRuntime);
  const { t, i18n } = useTranslation();
  const activeThread = useRef(thread?.id);
  activeThread.current = thread?.id;
  const [stopping, setStopping] = useState(false);
  const runningAttempts = threadAttempts.filter((attempt) =>
    ["queued", "dispatched", "running", "cancelling"].includes(attempt.status),
  );
  const stopMessage = async () => {
    setStopping(true);
    try {
      for (const attempt of runningAttempts) {
        if (attempt.status !== "cancelling") await invoke((api) => api.cancelAttempt(attempt.id));
      }
    } finally {
      setStopping(false);
    }
  };
  const forkMessage = async (messageId: string) => {
    if (!thread) return false;
    const source = thread.id;
    let forkId: string | undefined;
    const succeeded = await invoke(async (api) => {
      const result = await api.forkMessage(source, messageId);
      forkId = result.threadId;
      return result.snapshot;
    });
    if (succeeded && forkId && activeThread.current === source) selectThread(forkId);
    return succeeded;
  };
  const restartMessage = async (messageId: string, content: string) => {
    if (!thread) return false;
    return invoke(
      async (api) => (await api.restartMessage(thread.id, messageId, content)).snapshot,
    );
  };
  const [debugMessageId, setDebugMessageId] = useState<string>();
  const debugMessage = messages.find((message) => message.id === debugMessageId);
  const debugAttempt = threadAttempts.find((attempt) => attempt.id === debugMessage?.attemptId);
  const debugAgent = agents.find((agent) => agent.id === (debugAttempt?.agent ?? thread?.agent));
  const debugModel = debugAttempt?.modelRemoteId
    ? models.find(
        (model) =>
          model.provider === debugAttempt.modelProvider &&
          model.remoteId === debugAttempt.modelRemoteId,
      )
    : models.find((model) => model.id === thread?.modelId);
  const showMessageTelemetry = async (messageId: string) => {
    if (openMessageTelemetry) {
      try {
        if (await openMessageTelemetry(messageId)) return;
      } catch {
        // Browser previews and older frameworks keep the local dialog fallback.
      }
    }
    setDebugMessageId(messageId);
  };
  return (
    <section
      className={cn(
        "conversation",
        conversationStyles.conversation,
        "relative",
        "min-h-0",
        "min-w-0",
        "overflow-hidden",
      )}
      data-conversation-root
      data-thread-kind={nodeThread ? "workflow-node" : "conversation"}
    >
      <PaneToolbarFrame
        variant="workspace"
        showDividers={false}
        className={conversationStyles.conversationTitlebar}
        activeTabSlotClassName={conversationStyles.conversationActiveTabSlot}
        sidebarToggle={
          <Tooltip
            side="bottom"
            align="start"
            content={t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")}
          >
            <Button
              size="sm"
              className={titlebarStyles.titlebarButton}
              aria-label={t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")}
              onClick={onToggleSidebar}
            >
              <PanelLeft size={14} />
            </Button>
          </Tooltip>
        }
        addTab={
          <Tooltip side="bottom" content={i18n.t("explorerTitlebar.addTab")}>
            <Button
              size="sm"
              className={titlebarStyles.titlebarButton}
              aria-label={i18n.t("explorerTitlebar.addTab")}
              onClick={() => openTool("browser", true)}
            >
              <Plus size={14} />
            </Button>
          </Tooltip>
        }
        activeTab={
          <div className={conversationStyles.threadTitlebarControls}>
            {nodeThread ? (
              <Tooltip side="bottom" content={t("conversation.workflow")}>
                <Button
                  size="sm"
                  className={titlebarStyles.titlebarButton}
                  aria-label={t("conversation.workflow")}
                  onClick={() => openTool("workflow", false, nodeThread.goalId)}
                >
                  <Workflow size={14} />
                </Button>
              </Tooltip>
            ) : null}
            <div className={cn(conversationStyles.agentSelect, "flex", "items-center", "gap-1.5")}>
              <Monitor className={conversationStyles.agentSelectIcon} size={14} />
              <Select
                value={thread?.hostId ?? draftHostId ?? "local"}
                onValueChange={(value) => {
                  if (thread) void invoke((api) => api.selectHost(thread.id, value));
                  else setDraftHostId(value);
                }}
              >
                <SelectTrigger
                  className={conversationStyles.agentSelectTrigger}
                  aria-label={t(
                    nodeThread ? "conversation.workflowNodeThreadHost" : "conversation.threadHost",
                  )}
                >
                  <SelectValue placeholder={t("conversation.chooseHost")} />
                </SelectTrigger>
                <SelectContent className={conversationStyles.hostSelectContent}>
                  {hosts.map((host) => (
                    <SelectItem
                      className={conversationStyles.hostSelectItem}
                      key={host.id}
                      value={host.id}
                      title={host.displayName}
                    >
                      {host.displayName}
                      {host.status === "ready" ? "" : ` · ${host.status}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      />
      {newGoal && thread && (
        <Card className={conversationStyles.goalComposer}>
          <CardHeader className={conversationStyles.goalComposerHeader}>
            <CardTitle>{t("conversation.newGoal")}</CardTitle>
            <Tooltip content={t("conversation.cancel")}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("conversation.cancel")}
                onClick={() => setNewGoal(false)}
              >
                <X size={14} />
              </Button>
            </Tooltip>
          </CardHeader>
          <CardContent className={conversationStyles.goalComposerContent}>
            <Textarea
              className={conversationStyles.goalComposerTextarea}
              aria-label={t("conversation.goalPrompt")}
              value={goalPrompt}
              onChange={(event) => setGoalPrompt(event.target.value)}
              placeholder={t("conversation.goalPromptPlaceholder")}
            />
          </CardContent>
          <CardFooter className={conversationStyles.goalComposerFooter}>
            <Button
              size="sm"
              onClick={() => void createGoal()}
              disabled={!goalPrompt.trim() || creatingGoal}
            >
              {creatingGoal ? t("conversation.creating") : t("conversation.createGoal")}
            </Button>
          </CardFooter>
        </Card>
      )}
      {hasLegacyWorkflowData && (
        <div className={conversationStyles.legacyWorkflowNotice} role="alert">
          <span> {i18n.t("app.oldWorkflowDataWithoutWorkflowNodeThreadsWas")} </span>
          <Button
            className={conversationStyles.legacyWorkflowReset}
            variant="danger"
            size="sm"
            onClick={() => void invoke((api) => api.resetWorkflows())}
          >
            {i18n.t("app.clearOldWorkflowData")}{" "}
          </Button>
        </div>
      )}
      {goals
        .filter(
          (goal) => !["succeeded", "completed", "cancelled", "archived"].includes(goal.status),
        )
        .slice(-1)
        .map((goal) => (
          <ActiveWorkflowCard
            key={goal.id}
            goal={goal}
            nodes={workflowNodes.filter((node) => node.goalId === goal.id)}
            attempts={workflowAttempts}
            planningAttempts={threadAttempts}
            setupThreadId={workflowSetupThread(goal.id, workflowNodes, messages)}
            onOpenNode={selectThread}
            onInspect={() => openTool("workflow", false, goal.id)}
            onResolveGate={(nodeId, approved) => invoke((api) => api.resolveGate(nodeId, approved))}
          />
        ))}
      <MessageList
        workflowNodeThread={Boolean(nodeThread)}
        thread={thread}
        goals={goals}
        workflowNodes={workflowNodes}
        workflowAttempts={workflowAttempts}
        messages={messages}
        busy={busy}
        error={error}
        showMessageTelemetry={showMessageTelemetry}
        onResolveGate={(nodeId, approved) => invoke((api) => api.resolveGate(nodeId, approved))}
        openNodeThread={selectThread}
        onCompose={setMessageText}
        onFork={forkMessage}
        onRestart={restartMessage}
        openWorkflow={(goalId) => openTool("workflow", false, goalId)}
      />
      <Suspense fallback={<div className="min-h-24" />}>
        <MessageComposer
          thread={thread}
          skills={skills}
          messageText={messageText}
          setMessageText={setMessageText}
          messageImages={messageImages}
          attachmentError={attachmentError}
          addPastedImages={addPastedImages}
          removeMessageImage={removeMessageImage}
          sendingMessage={sendingMessage}
          running={runningAttempts.length > 0}
          stopping={stopping || runningAttempts.every((attempt) => attempt.status === "cancelling")}
          stopMessage={stopMessage}
          sendMessage={sendMessage}
          workspacePath={workspacePath}
          clearWorkspace={clearWorkspace}
          choosingWorkspace={choosingWorkspace}
          chooseWorkspace={chooseWorkspace}
          workspaceBindings={workspaceBindings}
          remoteHosts={remoteHosts}
          agents={agents}
          hosts={hosts}
          openHosts={openHosts}
          setWorkspaceBindings={async (bindingIds) => {
            if (thread)
              await invoke((api) => api.setThreadWorkspaceBindings(thread.id, bindingIds));
          }}
          addLocalWorkspace={addLocalWorkspace}
          addRemoteWorkspace={addRemoteWorkspace}
          draftAgentId={draftAgentId}
          setDraftAgentId={setDraftAgentId}
          selectAgent={(agentId) => {
            if (thread) void invoke((api) => api.selectAgent(thread.id, agentId));
            else setDraftAgentId(agentId);
          }}
          workflowNodeThread={Boolean(nodeThread)}
          hasMessages={messages.length > 0}
        />
      </Suspense>
      {debugMessage && (
        <Suspense fallback={null}>
          <MessageTelemetryDialog
            contextMessages={messages}
            message={debugMessage}
            attempt={debugAttempt}
            thread={thread}
            agent={debugAgent}
            model={debugModel}
            snapshotRevision={snapshotRevision}
            onOpenChange={(open) => {
              if (!open) setDebugMessageId(undefined);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
