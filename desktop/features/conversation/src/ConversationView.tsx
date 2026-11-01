import panesTokens from "@ovule/panes/panes.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import i18nTokens from "@ovule/i18n/i18n.token";
import settingsTokens from "@ovule/settings/settings.token";
import { threadFamilyOwners } from "./thread-family";
import { projectServices } from "@ovule/ioc/observable";

import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";

import { ThreadSurfaceFactory } from "./ThreadSurface";

import type { ConversationViewProps } from "./view";
import { cn } from "@ovule/ui/cn";
import styles from "./Conversation.module.css";
import { useObservableState } from "@ovule/ioc/react";

type ConversationDependencies = {
  ThreadSurface: ServiceOf<typeof ThreadSurfaceFactory>;
  explorer: ServiceOf<typeof panesTokens.panes>;
  selection: ServiceOf<typeof conversationTokens.selection>;
  stateView: ServiceOf<typeof StateProjectionFactory>;
  WorkspaceToolbar: ServiceOf<typeof panesTokens.workspaceToolbarView>;
};

function ConversationContent({
  dependencies,
  props,
}: {
  dependencies: ConversationDependencies;
  props: ConversationViewProps;
}) {
  const useLanguageMode = useService(i18nTokens.languageModeHook);

  const useThemeMode = useService(settingsTokens.themeModeHook);

  const { ThreadSurface, explorer, selection, stateView, WorkspaceToolbar } = dependencies;
  const { artifactBodyRef } = props;

  const snapshot = useObservableState(stateView, (state) => state.snapshot);
  const selectedThreadId = useObservableState(selection, (state) => state.selectedThreadId);
  const allTabs = useObservableState(explorer, (state) => state.instances);
  const activeArtifacts = useObservableState(explorer, (state) => state.activeThreadArtifacts);
  const { theme } = useThemeMode();
  const { languageMode } = useLanguageMode();
  const thread =
    selectedThreadId === ""
      ? undefined
      : (snapshot?.threads.find((item) => item.id === selectedThreadId) ?? snapshot?.threads[0]);
  const draftId = useObservableState(explorer, (state) => state.draftConversationId);
  const ownerId = thread?.id ?? draftId;
  const owners = threadFamilyOwners(thread?.id, snapshot);
  if (!thread) owners.add(draftId);
  const tabs = allTabs.filter(
    (tab) => tab.placement === "thread" && owners.has(tab.threadId ?? tab.draftId),
  );
  const active = tabs.find((tab) => tab.id === activeArtifacts[ownerId]);

  return (
    <div
      className={cn(
        "workspace",
        styles.workspace,
        "relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-none bg-(--background)",
      )}
      data-chat-workspace
    >
      <div
        className={cn(
          styles.threadContent,
          "col-start-1 row-span-2 row-start-1 min-h-0 min-w-0 overflow-hidden rounded-none bg-(--background)",
        )}
      >
        <ThreadSurface
          className={styles.threadSurface}
          threadId={thread?.id}
          theme={theme}
          languageMode={languageMode}
          selectThread={(id) => {
            explorer.selectThreadArtifact(id);
            selection.selectThread(id);
          }}
        />
      </div>
      {active && (
        <WorkspaceToolbar
          className={styles.workspaceTitlebar}
          tabs={tabs}
          active={active}
          threadId={thread?.id}
          draftId={!thread ? draftId : undefined}
        />
      )}
      <div
        ref={artifactBodyRef}
        className="col-start-1 row-start-2 min-h-0 min-w-0 overflow-hidden"
        hidden={!active}
      />
    </div>
  );
}

export const ConversationFactory = create((dependsOn) => {
  const ThreadSurface = dependsOn(ThreadSurfaceFactory);
  const explorer = dependsOn(panesTokens.panes);
  const selection = dependsOn(conversationTokens.selection);
  const stateView = dependsOn(StateProjectionFactory);
  const WorkspaceToolbar = dependsOn(panesTokens.workspaceToolbarView);
  const dependencies = {
    ThreadSurface,
    explorer,
    selection,
    stateView,
    WorkspaceToolbar,
  };
  return function Conversation(props: ConversationViewProps) {
    return createElement(ConversationContent, { dependencies, props });
  };
}, "Conversation");

export const Conversation = (...args: Parameters<ServiceOf<typeof ConversationFactory>>) =>
  createElement(useService(ConversationFactory), ...args);

const StateProjectionFactory = create((dependsOn) => {
  const conversation = dependsOn(conversationTokens.conversationState);
  const workflow = dependsOn(workflowTokens.workflowState);
  const reader = projectServices(
    [conversation, workflow] as const,
    (conversationState, workflowState) => ({
      snapshot: conversationState.snapshot
        ? {
            ...conversationState.snapshot,
            nodes: workflowState.snapshot?.nodes ?? [],
            goals: workflowState.snapshot?.goals ?? [],
            revision: [
              conversationState.snapshot.revision,
              workflowState.snapshot?.revision ?? 0n,
            ].reduce((latest, value) => (value > latest ? value : latest), 0n),
          }
        : undefined,
      pending: conversationState.pending,
      busy: conversationState.busy,
      error: conversationState.error,
    }),
  );
  return reader;
}, "WorkspaceStateProjection");
