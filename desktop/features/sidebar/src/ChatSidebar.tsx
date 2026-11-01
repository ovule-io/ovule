import { TabsSidebarGroup } from "./TabsSidebarGroup";
import terminalTokens from "@ovule/terminal/terminal.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import panesTokens from "@ovule/panes/panes.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import shellTokens from "@ovule/shell/shell.token";
import { projectServices } from "@ovule/ioc/observable";
import { createElement, useState, type ReactNode } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService, useObservableState } from "@ovule/ioc/react";
import { Button } from "@ovule/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@ovule/ui/sidebar";
import { Kbd } from "@ovule/ui/controls";
import { AppWindow, ChevronRight, Search, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThreadView } from "@ovule/shell-api";
import type { PaneInstance } from "@ovule/panes/tab";
import { cn } from "@ovule/ui/cn";
import { ThreadSidebarItem, type ThreadTreeModel } from "./ThreadSidebarItem";
import { SidebarPreferencesFactory } from "./sidebar-preferences";
import { forkConversation, runningThreadIds } from "./sidebar-model";
import styles from "./ChatSidebar.module.css";

type ChatSidebarProps = {
  thread?: ThreadView;
  draftId: string;
  preview?: { threadId?: string; target: string };
  openPreview?(): void;
  threads: ThreadView[];
  nodeThreads?: { thread: ThreadView; parentThreadId: string }[];
  onOpenThreadSwitcher(): void;
  onNewThread(): void;
  selectThread(id: string): void;
  renderTabIcon(tab: PaneInstance): ReactNode;
};

export const ChatSidebarFactory = create((dependsOn) => {
  const workbench = dependsOn(panesTokens.panes);
  const stateView = dependsOn(StateProjectionFactory);
  const preferences = dependsOn(SidebarPreferencesFactory);
  const runtime = dependsOn(shellTokens.snapshotSync);
  return function ChatSidebar(props: ChatSidebarProps) {
    const {
      thread,
      draftId,
      threads,
      nodeThreads = [],
      preview,
      openPreview,
      onOpenThreadSwitcher,
      onNewThread,
      selectThread,
      renderTabIcon,
    } = props;
    const { t } = useTranslation();
    const [archivedOpen, setArchivedOpen] = useState(false);
    const instances = useObservableState(workbench, (state) => state.instances);
    const activeWorkbenchId = useObservableState(workbench, (state) => state.activeWorkbenchPaneId);
    const activeArtifacts = useObservableState(workbench, (state) => state.activeThreadArtifacts);
    const snapshot = useObservableState(stateView, (state) => state.snapshot);
    const archived = useObservableState(preferences, (state) => state.archived);
    const model: ThreadTreeModel = {
      selectedThreadId: thread?.id,
      activeWorkbenchId,
      activeArtifacts,
      tabs: [...instances].reverse(),
      nodeThreads,
      preview,
      openPreview,
      selectThread,
      renderTabIcon,
      running: runningThreadIds(snapshot?.attempts ?? []),
      archived,
      setArchived: (id, archivedValue) => {
        preferences.setArchived(id, archivedValue);
        if (archivedValue && thread?.id === id) {
          const next = threads.find((item) => item.id !== id && !archived.includes(item.id));
          if (next) selectThread(next.id);
          else onNewThread();
        }
      },
      selectTab: (ownerId, tabId) => {
        const tab = instances.find((item) => item.id === tabId);
        if (tab?.placement !== "thread") {
          workbench.selectTab(tabId);
          return;
        }
        if (!tab.threadId) onNewThread();
        else if (thread?.id !== ownerId) selectThread(ownerId);
        workbench.selectThreadArtifact(ownerId, tabId);
      },
      closeTab: workbench.closeTab,
      moveTab: workbench.moveTabToWorkbench,
      canClose: (tab) =>
        !snapshot?.terminalRuns.some(
          (run) =>
            run.ownerId === tab.id && ["queued", "running", "cancelling"].includes(run.status),
        ),
      fork: async (source) => {
        let forkId: string | undefined;
        const success = await runtime.invoke(async (api) => {
          const result = await forkConversation(
            api,
            source,
            snapshot?.messages ?? [],
            (snapshot?.threads ?? []).map((item) => item.id),
          );
          forkId = result.threadId;
          return result.snapshot;
        });
        if (!success || !forkId) throw new Error(t("sidebar.actionFailed"));
        selectThread(forkId);
      },
      addTab: (threadId) => {
        selectThread(threadId);
        workbench.openTab("browser", { placement: "thread", threadId, newInstance: true });
      },
    };
    const conversations = threads.filter((item) => !archived.includes(item.id));
    const unboundTabs = [...instances].reverse().filter((tab) => !tab.threadId);
    const newTab = () => {
      onNewThread();
      workbench.openTab("browser", {
        placement: "thread",
        draftId,
        newInstance: true,
      });
    };
    const archivedThreads = [...threads, ...nodeThreads.map((child) => child.thread)].filter(
      (item) => archived.includes(item.id),
    );
    return (
      <Sidebar className={cn("sidebar", styles.sidebar)} data-chat-sidebar>
        <SidebarHeader>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className={cn("sidebar-search", styles.sidebarSearch)}
            aria-label={t("threadSwitcher.title")}
            onClick={onOpenThreadSwitcher}
          >
            <Search size={14} />
            <span className={styles.sidebarSearchLabel}>{t("sidebar.search")}</span>
            <Kbd className={styles.sidebarSearchShortcut}>⌘ K</Kbd>
          </Button>
          <SidebarMenu className={styles.sidebarPrimaryMenu}>
            <SidebarMenuItem>
              <SidebarMenuButton className={styles.sidebarNewConversation} onClick={onNewThread}>
                <SquarePen size={15} />
                <span>{t("sidebar.newConversation")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={newTab} data-sidebar-new-tab>
                <AppWindow size={15} />
                <span>{t("sidebar.newTab")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <TabsSidebarGroup tabs={unboundTabs} draftId={draftId} model={model} />
          {conversations.length > 0 && (
            <SidebarGroup data-sidebar-conversations>
              <SidebarGroupLabel>{t("sidebar.conversations")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {conversations.map((item) => (
                    <ThreadSidebarItem key={item.id} thread={item} model={model} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          {archivedThreads.length > 0 && (
            <SidebarGroup data-archived-threads>
              <SidebarGroupLabel>
                <button
                  type="button"
                  className={styles.archiveToggle}
                  aria-expanded={archivedOpen}
                  onClick={() => setArchivedOpen((value) => !value)}
                >
                  <ChevronRight
                    size={12}
                    className={archivedOpen ? styles.expandedChevron : undefined}
                  />
                  {t("sidebar.archived")} ({archivedThreads.length})
                </button>
              </SidebarGroupLabel>
              {archivedOpen && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {archivedThreads.map((item) => (
                      <ThreadSidebarItem key={item.id} thread={item} model={model} />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>
    );
  };
}, "ChatSidebar");

export const ChatSidebar = (...args: Parameters<ServiceOf<typeof ChatSidebarFactory>>) =>
  createElement(useService(ChatSidebarFactory), ...args);

const StateProjectionFactory = create((dependsOn) => {
  const terminal = dependsOn(terminalTokens.terminalState);
  const workspace = dependsOn(workspaceTokens.workspaceState);
  const conversation = dependsOn(conversationTokens.conversationState);
  const workflow = dependsOn(workflowTokens.workflowState);
  const reader = projectServices(
    [terminal, workspace, conversation, workflow] as const,
    (terminalState, workspaceState, conversationState, workflowState) => ({
      snapshot:
        terminalState.snapshot &&
        workspaceState.snapshot &&
        conversationState.snapshot &&
        workflowState.snapshot
          ? {
              ...terminalState.snapshot,
              ...workspaceState.snapshot,
              ...conversationState.snapshot,
              ...workflowState.snapshot,
              revision: [
                terminalState.snapshot.revision,
                workspaceState.snapshot.revision,
                conversationState.snapshot.revision,
                workflowState.snapshot.revision,
              ].reduce((latest, value) => (value > latest ? value : latest), 0n),
            }
          : undefined,
      pending:
        terminalState.pending +
        workspaceState.pending +
        conversationState.pending +
        workflowState.pending,
      busy:
        terminalState.busy || workspaceState.busy || conversationState.busy || workflowState.busy,
      error:
        terminalState.error ??
        workspaceState.error ??
        conversationState.error ??
        workflowState.error,
    }),
  );
  return reader;
}, "ChatSidebarStateProjection");
