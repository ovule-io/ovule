import { SidebarTabIcon } from "./SidebarTabIcon";
import panesTokens from "@ovule/panes/panes.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { projectServices } from "@ovule/ioc/observable";

import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";

import { ChatSidebarFactory } from "./ChatSidebar";

import type { SidebarViewProps } from "./view";
import { useObservableState } from "@ovule/ioc/react";

export const SidebarFactory = create((dependsOn) => {
  const ChatSidebar = dependsOn(ChatSidebarFactory);
  const explorer = dependsOn(panesTokens.panes);
  const selection = dependsOn(conversationTokens.selection);
  const overlays = dependsOn(frameworkTokens.mainOverlay);
  const stateView = dependsOn(StateProjectionFactory);
  return function Sidebar({ onOpenThreadSwitcher, onNewThread }: SidebarViewProps) {
    const selectedThreadId = useObservableState(selection, (state) => state.selectedThreadId);
    const draftId = useObservableState(explorer, (state) => state.draftConversationId);
    const preview = useObservableState(overlays, (state) =>
      state.explorer &&
      Object.values(state.explorerTabs).some((entry) => entry.id === state.explorer?.id)
        ? undefined
        : state.explorer,
    );
    const snapshot = useObservableState(stateView, (state) => state.snapshot);
    const thread =
      selectedThreadId === ""
        ? undefined
        : (snapshot?.threads.find((item) => item.id === selectedThreadId) ?? snapshot?.threads[0]);
    const nodeThreadIds = new Set(snapshot?.nodes.map((node) => node.threadId).filter(Boolean));

    return (
      <ChatSidebar
        thread={thread}
        draftId={draftId}
        preview={preview}
        openPreview={() => preview && overlays.openExplorer(preview)}
        nodeThreads={(snapshot?.nodes ?? []).flatMap((node) => {
          const child = snapshot?.threads.find((item) => item.id === node.threadId);
          const goal = snapshot?.goals.find((item) => item.id === node.goalId);
          return child && goal ? [{ thread: child, parentThreadId: goal.threadId }] : [];
        })}
        threads={snapshot?.threads.filter((item) => !nodeThreadIds.has(item.id)) ?? []}
        onOpenThreadSwitcher={onOpenThreadSwitcher}
        onNewThread={onNewThread}
        selectThread={(id) => {
          overlays.close("settings");
          overlays.close("remoteWorkspaces");
          explorer.selectThreadArtifact(id);
          selection.selectThread(id);
        }}
        renderTabIcon={(tab) => <SidebarTabIcon tab={tab} />}
      />
    );
  };
}, "Sidebar");

export const Sidebar = (...args: Parameters<ServiceOf<typeof SidebarFactory>>) =>
  createElement(useService(SidebarFactory), ...args);

const StateProjectionFactory = create((dependsOn) => {
  const conversation = dependsOn(conversationTokens.conversationState);
  const workflow = dependsOn(workflowTokens.workflowState);
  const reader = projectServices(
    [conversation, workflow] as const,
    (conversationState, workflowState) => ({
      snapshot:
        conversationState.snapshot && workflowState.snapshot
          ? {
              ...conversationState.snapshot,
              ...workflowState.snapshot,
              revision: [
                conversationState.snapshot.revision,
                workflowState.snapshot.revision,
              ].reduce((latest, value) => (value > latest ? value : latest), 0n),
            }
          : undefined,
      pending: conversationState.pending + workflowState.pending,
      busy: conversationState.busy || workflowState.busy,
      error: conversationState.error ?? workflowState.error,
    }),
  );
  return reader;
}, "SidebarStateProjection");
