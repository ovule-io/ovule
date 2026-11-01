import conversationTokens from "@ovule/conversation/conversation.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { resolveDraftAgent } from "./draftAgent";
import { useCallback, useEffect, useState } from "react";

import { useService } from "@ovule/ioc/react";
import { useServiceState } from "@ovule/ioc/react";
import { DesktopStateFactory } from "../state";

export function useThreadController({
  chooseDirectory,
  onSelectThread,
  afterMutation,
  onDraftCommitted,
}: {
  chooseDirectory?: (title: string) => Promise<string | undefined>;
  onSelectThread?: (id: string) => void;
  afterMutation?: () => Promise<void>;
  onDraftCommitted?: (threadId: string) => Promise<void>;
} = {}) {
  const { useGoalDraft } = useService(workflowTokens.routeRuntime);
  const { useConversationProjection, useThreadDraft } = useService(conversationTokens.routeRuntime);
  const { useMessageDraft } = useService(conversationTokens.composerRouteRuntime);
  const stateView = useService(DesktopStateFactory);
  const runtimeState = useServiceState(DesktopStateFactory, (state) => state);
  const runtime = {
    ...runtimeState,
    invoke: stateView.invoke,
    acceptSnapshot: stateView.acceptSnapshot,
  };
  const selectionService = useService(conversationTokens.selection);
  const selectionState = useServiceState(conversationTokens.selection, (state) => state);
  const selection = {
    ...selectionState,
    selectThread: selectionService.selectThread,
    clearThread: selectionService.clearThread,
    selectGoal: selectionService.selectGoal,
  };
  const workspace = useService(workspaceTokens.workspace);
  const [defaultAgentId, setDefaultAgentId] = useState("");
  const [chosenDraftAgentId, setDraftAgentId] = useState("");
  const agentConfiguration = runtime.snapshot?.agents
    .map((agent) => `${agent.id}:${agent.enabled}`)
    .join(",");
  useEffect(() => {
    let active = true;
    void workspace
      .api()
      .then((api) => api.onboardingStatus())
      .then((status) => {
        if (active) setDefaultAgentId(status.defaultAgentId ?? "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace, agentConfiguration]);
  const [draftHostId, setDraftHostId] = useState("local");
  const draftAgentId = resolveDraftAgent(
    runtime.snapshot?.agents ?? [],
    runtime.snapshot?.hosts ?? [],
    draftHostId,
    chosenDraftAgentId,
    defaultAgentId,
  );
  const projection = useConversationProjection(
    runtime.snapshot,
    selection.selectedThreadId,
    selection.selectedGoalId,
  );
  const invoke = useCallback(
    async (operation: Parameters<typeof stateView.invoke>[0]) => {
      const succeeded = await stateView.invoke(operation);
      if (succeeded) await afterMutation?.();
      return succeeded;
    },
    [afterMutation, stateView],
  );
  const selectDraftThread = (id: string) => {
    // A pending first send must not steal focus after the user switches Threads.
    if (selectionService.current().selectedThreadId !== "") return;
    selection.selectThread(id);
    onSelectThread?.(id);
  };
  const threadDraft = useThreadDraft(
    projection.thread,
    invoke,
    selection.clearThread,
    chooseDirectory,
  );
  const goalDraft = useGoalDraft(projection.thread, invoke);
  const messageDraft = useMessageDraft(
    runtime.snapshot,
    projection.thread,
    invoke,
    selectDraftThread,
    threadDraft.workspacePath,
    draftAgentId || undefined,
    draftHostId,
    () => setDraftAgentId(""),
    onDraftCommitted,
  );
  return {
    runtime,
    invoke,
    selection,
    snapshot: runtime.snapshot,
    ...projection,
    ...threadDraft,
    ...goalDraft,
    ...messageDraft,
    draftAgentId,
    setDraftAgentId,
    draftHostId,
    setDraftHostId,
  };
}

export type ThreadController = ReturnType<typeof useThreadController>;
