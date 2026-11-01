import { PaneLoading } from "@ovule/ui/pane-loading";
import conversationTokens from "@ovule/conversation/conversation.token";
import panesTokens from "@ovule/panes/panes.token";
import shellTokens from "@ovule/shell/shell.token";
import { useApplicationLifecycle } from "../shared/useApplicationLifecycle";
import { useCallback, useEffect, useState } from "react";
import { useService } from "@ovule/ioc/react";
import { usePaneController } from "./usePaneController";

import type { TuffiteMessageEvent } from "@ovule/shell/explorer";

export function PaneApp() {
  const panes = useService(panesTokens.paneRegistry);
  const shell = useService(shellTokens.shell);
  const selection = useService(conversationTokens.selection);
  useApplicationLifecycle({ browserUse: "none" });
  const refreshRoot = useCallback(
    () => shell.requestRoot("workspace.refresh", {}).then(() => undefined),
    [shell],
  );
  const vm = usePaneController(refreshRoot);
  const query = new URL(location.href).searchParams;
  const kind = query.get("kind");
  const [target, setTarget] = useState(query.get("target") ?? undefined);
  const workspaceBindingId = query.get("workspaceBinding") ?? undefined;
  const useThreadWorkspace = query.get("useThreadWorkspace") === "true";
  const [requestVersion, setRequestVersion] = useState(1);
  const id = query.get("tab") ?? "tool";
  const targetGoal =
    kind === "workflow" && target ? vm.snapshot?.goals.find((item) => item.id === target) : vm.goal;
  useEffect(() => {
    const api = shell.messageApi();
    const receive = (event: TuffiteMessageEvent) => {
      if (event.origin !== location.origin) return;
      const data = event.data as {
        type?: string;
        target?: string;
        action?: string;
        threadId?: string;
      };
      if (data?.type === "appearance.sync" && typeof data.threadId === "string") {
        if (data.threadId) selection.selectThread(data.threadId);
        else selection.clearThread();
      }
      if (data?.type === "tab.navigate" && typeof data.target === "string") {
        setTarget(data.target);
        setRequestVersion((version) => version + 1);
      }
      if (data?.type === "pane.command" && typeof data.action === "string") {
        window.dispatchEvent(
          new CustomEvent("ovule:pane-command", { detail: { action: data.action } }),
        );
      }
    };
    api?.addEventListener("message", receive);
    return () => api?.removeEventListener("message", receive);
  }, [kind, shell, selection]);
  useEffect(() => {
    if (vm.snapshot) void shell.requestRoot("tab.ready", { tabId: id }).catch(console.error);
  }, [Boolean(vm.snapshot), id, shell]);
  useEffect(() => {
    if (targetGoal) {
      void shell
        .requestRoot("tab.metadata", { tabId: id, title: targetGoal.title })
        .catch(console.error);
    }
  }, [id, shell, targetGoal]);
  if (!vm.snapshot) return <PaneLoading error={vm.runtime.error} />;
  const goal = targetGoal;
  const nodes = vm.snapshot.nodes.filter((node) => node.goalId === goal?.id);
  const Pane = panes.resolve(kind).component;
  return (
    <Pane
      id={id}
      target={target}
      workspaceBindingId={workspaceBindingId}
      shellProfileId={query.get("shellProfile") ?? undefined}
      useThreadWorkspace={useThreadWorkspace}
      requestVersion={requestVersion}
      thread={vm.thread}
      goal={goal}
      nodes={nodes}
      invoke={vm.invoke}
      snapshot={vm.snapshot}
      busy={vm.runtime.busy}
      openNodeThread={(threadId) => {
        void shell.requestRoot("thread.select", { threadId });
      }}
    />
  );
}
