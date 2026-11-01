import conversationTokens from "@ovule/conversation/conversation.token";
import { useCallback } from "react";

import { useService } from "@ovule/ioc/react";
import { useServiceState } from "@ovule/ioc/react";
import { DesktopStateFactory } from "../state";

export function usePaneController(afterMutation: () => Promise<void>) {
  const { useConversationProjection } = useService(conversationTokens.routeRuntime);
  const stateView = useService(DesktopStateFactory);
  const runtime = useServiceState(DesktopStateFactory, (state) => state);
  const selection = useServiceState(conversationTokens.selection, (state) => state);
  const projection = useConversationProjection(
    runtime.snapshot,
    selection.selectedThreadId,
    selection.selectedGoalId,
    false,
  );
  const invoke = useCallback(
    async (operation: Parameters<typeof stateView.invoke>[0]) => {
      const succeeded = await stateView.invoke(operation);
      if (succeeded) await afterMutation();
      return succeeded;
    },
    [stateView, afterMutation],
  );
  return {
    runtime: { ...runtime, invoke: stateView.invoke },
    snapshot: runtime.snapshot,
    ...projection,
    invoke,
  };
}
