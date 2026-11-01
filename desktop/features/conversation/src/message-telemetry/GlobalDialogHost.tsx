import conversationTokens from "@ovule/conversation/conversation.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import settingsTokens from "@ovule/settings/settings.token";
import { projectServices } from "@ovule/ioc/observable";

import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { lazy, Suspense, useEffect, useState } from "react";

const MessageTelemetryDialog = lazy(() =>
  import("./MessageTelemetryDialog").then((module) => ({ default: module.MessageTelemetryDialog })),
);
import type { MessageTelemetryRuntime } from "./MessageTelemetryDialog";
import { useObservableState } from "@ovule/ioc/react";

type GlobalDialogRequest = {
  kind: "message-telemetry";
  messageId: string;
  runtime?: MessageTelemetryRuntime;
};

export const GlobalDialogHostFactory = create((dependsOn) => {
  const stateView = dependsOn(StateProjectionFactory);
  return function GlobalDialogHost() {
    const [request, setRequest] = useState<GlobalDialogRequest>();
    const snapshot = useObservableState(stateView, (state) => state.snapshot);

    useEffect(() => {
      const open = (event: Event) => {
        const detail = (event as CustomEvent<GlobalDialogRequest | undefined>).detail;
        if (detail?.kind !== "message-telemetry" || !detail.messageId) return;
        setRequest(detail);
      };
      window.addEventListener("ovule:global-dialog", open);
      return () => window.removeEventListener("ovule:global-dialog", open);
    }, []);

    if (!snapshot || !request) return null;

    const message = snapshot.messages.find((item) => item.id === request?.messageId);
    const thread = snapshot.threads.find((item) => item.id === message?.threadId);
    const attempt = snapshot.attempts.find((item) => item.id === message?.attemptId);
    const agent = snapshot.agents.find((item) => item.id === (attempt?.agent ?? thread?.agent));
    const model = attempt?.modelRemoteId
      ? snapshot.models.find(
          (item) =>
            item.provider === attempt.modelProvider && item.remoteId === attempt.modelRemoteId,
        )
      : snapshot.models.find((item) => item.id === thread?.modelId);

    return (
      <Suspense fallback={null}>
        <MessageTelemetryDialog
          contextMessages={snapshot.messages}
          message={message}
          attempt={attempt}
          thread={thread}
          agent={agent}
          model={model}
          snapshotRevision={snapshot.revision}
          runtime={request?.runtime}
          onOpenChange={(open) => {
            if (!open) setRequest(undefined);
          }}
        />
      </Suspense>
    );
  };
}, "GlobalDialogHost");

export const GlobalDialogHost = (...args: Parameters<ServiceOf<typeof GlobalDialogHostFactory>>) =>
  createElement(useService(GlobalDialogHostFactory), ...args);

const StateProjectionFactory = create((dependsOn) => {
  const conversation = dependsOn(conversationTokens.conversationState);
  const workflow = dependsOn(workflowTokens.workflowState);
  const agents = dependsOn(settingsTokens.agentsState);
  const models = dependsOn(settingsTokens.modelsState);
  const reader = projectServices(
    [conversation, workflow, agents, models] as const,
    (conversationState, workflowState, agentsState, modelsState) => ({
      snapshot:
        conversationState.snapshot &&
        workflowState.snapshot &&
        agentsState.snapshot &&
        modelsState.snapshot
          ? {
              ...conversationState.snapshot,
              ...workflowState.snapshot,
              ...agentsState.snapshot,
              ...modelsState.snapshot,
              revision: [
                conversationState.snapshot.revision,
                workflowState.snapshot.revision,
                agentsState.snapshot.revision,
                modelsState.snapshot.revision,
              ].reduce((latest, value) => (value > latest ? value : latest), 0n),
            }
          : undefined,
      pending:
        conversationState.pending +
        workflowState.pending +
        agentsState.pending +
        modelsState.pending,
      busy: conversationState.busy || workflowState.busy || agentsState.busy || modelsState.busy,
      error:
        conversationState.error ?? workflowState.error ?? agentsState.error ?? modelsState.error,
    }),
  );
  return reader;
}, "GlobalDialogHostStateProjection");
