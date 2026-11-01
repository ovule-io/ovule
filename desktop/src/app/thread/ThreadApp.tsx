import conversationTokens from "@ovule/conversation/conversation.token";
import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import shellTokens from "@ovule/shell/shell.token";
import { useApplicationLifecycle } from "../shared/useApplicationLifecycle";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ConversationPane } from "./ConversationPane";
import { useThreadController } from "./useThreadController";

import type { TuffiteMessageEvent } from "@ovule/shell/explorer";
import type { PaneInstance, PaneKind } from "@ovule/panes/tab";

import { useService } from "@ovule/ioc/react";

export function ThreadApp() {
  const { encodeHumanHandoff } = useService(messagePartsTokens.routeRuntime);
  const { captureMessageTelemetryRuntime } = useService(
    conversationTokens.messageTelemetryRouteRuntime,
  );
  const { i18n } = useTranslation();
  const shell = useService(shellTokens.shell);
  const workspace = useService(workspaceTokens.workspace);
  const selection = useService(conversationTokens.selection);
  const [draftId, setDraftId] = useState(
    () => new URL(location.href).searchParams.get("draft") ?? "",
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [threadTabs, setThreadTabs] = useState<PaneInstance[]>([]);
  useApplicationLifecycle({ browserUse: "none", agentApprovals: true });
  const refreshRoot = useCallback(
    () => shell.requestRoot("workspace.refresh", {}).then(() => undefined),
    [shell],
  );

  useEffect(
    () =>
      workspace.observeOfficeUse((request) => {
        void shell.requestRoot("workbench.open", {
          kind: "office",
          target: request.target,
          newInstance: true,
        });
      }),
    [shell, workspace],
  );
  const vm = useThreadController({
    afterMutation: refreshRoot,
    onDraftCommitted: async (threadId) => {
      await shell.requestRoot("thread.bindDraft", { draftId, threadId });
    },
    chooseDirectory: async (title) => {
      const result = await shell.requestRoot<{ path: string | null }>("dialog.openDirectory", {
        title,
      });
      return result.path ?? undefined;
    },
    onSelectThread: (threadId) => {
      void shell.requestRoot("thread.select", { threadId });
    },
  });
  const { runtime, snapshot } = vm;

  useEffect(
    () =>
      workspace.observeBrowserUse((request) => {
        void shell.requestRoot(request.target ? "links.open" : "workbench.open", {
          kind: "browser",
          target: request.target,
          navigation: request.navigation,
          placement: request.placement,
          newInstance: true,
        });
      }),
    [shell, workspace],
  );

  useEffect(
    () =>
      workspace.observeHumanHandoff((request) => {
        void shell.requestRoot("workbench.open", {
          kind: "handoff",
          target: encodeHumanHandoff(request),
          newInstance: true,
        });
      }),
    [shell, workspace],
  );

  useEffect(() => {
    const tuffite = shell.messageApi();
    if (!tuffite) return;
    const sync = (event: TuffiteMessageEvent) => {
      const message = event.data as {
        type?: unknown;
        theme?: unknown;
        language?: unknown;
        sidebarOpen?: unknown;
        threadTabs?: unknown;
        threadId?: unknown;
        draftId?: unknown;
      };
      if (message?.type !== "appearance.sync") return;
      if (typeof message.draftId === "string") setDraftId(message.draftId);
      if (
        typeof message.threadId === "string" &&
        message.threadId !== (selection.current().selectedThreadId ?? "")
      ) {
        if (message.threadId) selection.selectThread(message.threadId);
        else selection.clearThread();
      }
      if (message.theme === "light" || message.theme === "dark") {
        document.documentElement.dataset.theme = message.theme;
        document.documentElement.style.colorScheme = message.theme;
      }
      if (message.language === "zh-CN" || message.language === "en") {
        document.documentElement.lang = message.language;
        void i18n.changeLanguage(message.language);
      }
      if (typeof message.sidebarOpen === "boolean") setSidebarOpen(message.sidebarOpen);
      if (Array.isArray(message.threadTabs)) setThreadTabs(message.threadTabs as PaneInstance[]);
    };
    tuffite.addEventListener("message", sync);
    return () => tuffite.removeEventListener("message", sync);
  }, [shell]);

  if (!snapshot) {
    return (
      <main className="flex h-full w-full items-center justify-center gap-2 bg-(--background) text-(--muted-foreground) text-(length:--font-size-ui)">
        {runtime.error ? (
          runtime.error
        ) : (
          <>
            <LoaderCircle className="animate-spin" /> {i18n.t("workspace.loadingConversation")}{" "}
          </>
        )}
      </main>
    );
  }

  const openTool = (kind: PaneKind, newInstance = false, target?: string) => {
    void shell.requestRoot("workbench.open", { kind, newInstance, target });
    return `root-${kind}`;
  };

  return (
    <ConversationPane
      thread={vm.thread}
      goals={vm.goals}
      nodeThread={vm.nodeThread}
      workflowNodes={vm.workflowNodes}
      workflowAttempts={vm.workflowAttempts}
      messages={vm.messages}
      threadAttempts={vm.threadAttempts}
      agents={snapshot.agents}
      hosts={snapshot.hosts}
      models={snapshot.models}
      snapshotRevision={snapshot.revision}
      skills={snapshot.skills}
      busy={runtime.busy}
      error={runtime.error ?? vm.interactionError}
      newGoal={vm.newGoal}
      setNewGoal={vm.setNewGoal}
      goalPrompt={vm.goalPrompt}
      setGoalPrompt={vm.setGoalPrompt}
      creatingGoal={vm.creatingGoal}
      prepareGoal={vm.prepareGoal}
      createGoal={vm.createGoal}
      messageText={vm.messageText}
      setMessageText={vm.setMessageText}
      messageImages={vm.messageImages}
      attachmentError={vm.attachmentError}
      addPastedImages={vm.addPastedImages}
      removeMessageImage={vm.removeMessageImage}
      sendingMessage={vm.sendingMessage}
      sendMessage={vm.sendMessage}
      workspacePath={vm.workspacePath}
      clearWorkspace={vm.clearWorkspace}
      choosingWorkspace={vm.choosingWorkspace}
      chooseWorkspace={vm.chooseWorkspace}
      openTool={openTool}
      openMessageTelemetry={async (messageId) => {
        const result = await shell.requestRoot<{ shown: boolean }>("ui.dialog.open", {
          kind: "message-telemetry",
          messageId,
          runtime: captureMessageTelemetryRuntime(),
        });
        return result.shown;
      }}
      invoke={vm.invoke}
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => {
        setSidebarOpen((open) => !open);
        void shell.requestRoot("layout.toggleSidebar", {});
      }}
      workspaceBindings={snapshot.bindings}
      remoteHosts={snapshot.endpoints.filter((endpoint) => endpoint.transport === "tunnel")}
      openHosts={() => void shell.requestRoot("remoteWorkspaces.open", {})}
      addLocalWorkspace={async () => {
        if (!vm.thread) return;
        const result = await shell.requestRoot<{ path: string | null }>("dialog.openDirectory", {
          title: i18n.t("composer.addLocalWorkspace"),
        });
        if (!result.path) return;
        const alias =
          result.path
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .at(-1) || "local";
        await vm.invoke((api) =>
          api.bindWorkspace({
            threadId: vm.thread!.id,
            kind: "local",
            root: result.path!,
            alias,
          }),
        );
      }}
      addRemoteWorkspace={async (endpoint, resource) => {
        if (!vm.thread) return;
        await vm.invoke(async (api) => {
          await api.bindWorkspace({
            threadId: vm.thread!.id,
            kind: "tunnel",
            endpointId: endpoint.id,
            resourceId: resource.shareId,
            root: resource.root,
            alias: resource.alias,
          });
          return api.selectHost(vm.thread!.id, endpoint.id);
        });
      }}
      draftAgentId={vm.draftAgentId}
      setDraftAgentId={vm.setDraftAgentId}
      draftHostId={vm.draftHostId}
      setDraftHostId={vm.setDraftHostId}
      threadTabs={threadTabs}
      selectTab={(tabId) => {
        void shell.requestRoot("tab.select", { tabId });
      }}
      selectThread={(threadId) => {
        vm.selection.selectThread(threadId);
        void shell.requestRoot("thread.select", { threadId });
      }}
      hasLegacyWorkflowData={snapshot.legacyDataIssues.some(
        (issue) => issue.id === "workflow-missing-execution-context",
      )}
    />
  );
}
