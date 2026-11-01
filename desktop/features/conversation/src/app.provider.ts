import conversationTokens from "./conversation.token";
import type { Register } from "@ovule/ioc";
import { createSelectionService } from "./selection/service";
import { useConversationProjection } from "./useConversationProjection";
import { useThreadDraft } from "./useThreadDraft";
import { value } from "@ovule/ioc";
import { useMessageDraft } from "./composer/useMessageDraft";
import { createConversationStateService } from "./state-service";
import { lazy } from "react";
import { captureMessageTelemetryRuntime } from "./message-telemetry/runtime";
export default function register(register: Register): void {
  registerComposerRoute(register);
  registerConversationState(register);
  register(conversationTokens.selection, () => createSelectionService());
  register(conversationTokens.routeRuntime, value({ useConversationProjection, useThreadDraft }));
  registerMessageTelemetryRoute(register);
}

function registerComposerRoute(register: Register): void {
  const MessageComposer = lazy(() =>
    import("./composer/MessageComposer").then((module) => ({ default: module.MessageComposer })),
  );
  register(conversationTokens.composerRouteRuntime, value({ MessageComposer, useMessageDraft }));
}

function registerConversationState(register: Register): void {
  register(conversationTokens.stateController, () => createConversationStateService());
  register(
    conversationTokens.conversationState,
    (dependsOn) => dependsOn(conversationTokens.stateController).service,
  );
}

function registerMessageTelemetryRoute(register: Register): void {
  const MessageTelemetryDialog = lazy(() =>
    import("./message-telemetry/MessageTelemetryDialog").then((module) => ({
      default: module.MessageTelemetryDialog,
    })),
  );
  const GlobalDialogHost = lazy(() =>
    import("./message-telemetry/GlobalDialogHost.tsx").then((module) => ({
      default: module.GlobalDialogHost,
    })),
  );
  register(
    conversationTokens.messageTelemetryRouteRuntime,
    value({
      MessageTelemetryDialog,
      captureMessageTelemetryRuntime,
      GlobalDialogHost,
    }),
  );
}
