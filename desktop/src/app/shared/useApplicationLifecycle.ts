import browserTokens from "@ovule/browser/browser.token";
import frameworkTokens from "@ovule/framework/framework.token";
import shellTokens from "@ovule/shell/shell.token";
import panesTokens from "@ovule/panes/panes.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import { create, type ServiceOf } from "@ovule/ioc";
import { useEffect } from "react";
import { useService } from "@ovule/ioc/react";

type UseWorkspaceLifecycleDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
  links: ServiceOf<typeof browserTokens.links> | undefined;
  runtime: ServiceOf<typeof shellTokens.snapshotSync>;
  selection: ServiceOf<typeof conversationTokens.selection>;
  workbench: ServiceOf<typeof panesTokens.panes> | undefined;
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
  overlays: ServiceOf<typeof frameworkTokens.mainOverlay> | undefined;
  handoff: ServiceOf<typeof messagePartsTokens.handoffProtocol>;
};

function useApplicationLifecycleImpl(
  dependencies: UseWorkspaceLifecycleDependencies,
  {
    browserUse = "local",
    agentApprovals = browserUse !== "none",
  }: { browserUse?: "local" | "none"; agentApprovals?: boolean } = {},
) {
  const { runtime, selection, workbench, workspace, handoff, overlays, links, shell } =
    dependencies;
  useEffect(
    () => (agentApprovals ? shell.installAgentApprovals?.() : undefined),
    [shell, agentApprovals],
  );

  useEffect(
    () =>
      browserUse === "none"
        ? undefined
        : shell.installBrowserControl?.((agent, url, threadId) => {
            if (!overlays) throw new Error("Browser overlay host unavailable");
            const current = overlays.current().explorer?.agent;
            if (current && current !== agent && current.status() !== "closed")
              throw new Error(
                "Another Agent browser occupies the overlay; move it to a sidebar, workbench or window first",
              );
            overlays.openExplorer({
              target: url,
              threadId: threadId ?? selection.current().selectedThreadId,
              agent,
            });
          }),
    [shell, browserUse, overlays, selection],
  );
  useEffect(() => shell.installDesktopControlFeedback?.(), [shell]);

  useEffect(() => {
    void runtime.load();
    return workspace.observeWorkspace(() => void runtime.load());
  }, [runtime, workspace]);

  useEffect(
    () => workspace.observeAgentOutput((event) => runtime.appendAgentOutput(event)),
    [runtime, workspace],
  );

  useEffect(() => {
    if (browserUse === "none" || !workbench || !links) return;
    return workspace.observeBrowserUse((request) => {
      const selectedThreadId = selection.current().selectedThreadId;
      if (request.target && /^(?:https?|file):\/\//i.test(request.target)) {
        void links
          .open({
            target: request.target,
            threadId: request.threadId ?? selectedThreadId,
            navigation: request.navigation,
          })
          .catch(console.error);
        return;
      }
      const placement =
        request.placement ?? (request.target && selectedThreadId ? "thread" : "workbench");
      workbench.openTab("browser", {
        placement,
        newInstance: true,
        target: request.target,
        autoLoad: Boolean(request.target),
        threadId: selectedThreadId,
      });
    });
  }, [browserUse, selection, workbench, workspace, handoff, overlays, links]);

  useEffect(() => {
    if (browserUse === "none" || !workbench) return;
    return workspace.observeOfficeUse((request) => {
      const selectedThreadId = selection.current().selectedThreadId;
      workbench.openTab("office", {
        placement: request.target && selectedThreadId ? "thread" : "workbench",
        newInstance: true,
        target: request.target,
        autoLoad: true,
        threadId: selectedThreadId,
      });
    });
  }, [browserUse, selection, workbench, workspace, handoff]);

  useEffect(() => {
    if (browserUse === "none" || !workbench) return;
    return workspace.observeHumanHandoff((request) => {
      workbench.openTab("handoff", {
        placement: "workbench",
        newInstance: true,
        target: handoff.encodeHumanHandoff(request),
        threadId: selection.current().selectedThreadId,
      });
    });
  }, [browserUse, selection, workbench, workspace, handoff]);
}

export const useApplicationLifecycleFactory = create((dependsOn) => {
  const runtime = dependsOn(shellTokens.snapshotSync);
  const selection = dependsOn(conversationTokens.selection);
  const workbench = dependsOn.optional(panesTokens.panes);
  const workspace = dependsOn(workspaceTokens.workspace);
  return useApplicationLifecycleImpl.bind(undefined, {
    shell: dependsOn(shellTokens.shell),
    links: dependsOn.optional(browserTokens.links),
    overlays: dependsOn.optional(frameworkTokens.mainOverlay),
    handoff: dependsOn(messagePartsTokens.handoffProtocol),
    runtime,
    selection,
    workbench,
    workspace,
  });
}, "useApplicationLifecycle");

export const useApplicationLifecycle = (
  ...args: Parameters<ServiceOf<typeof useApplicationLifecycleFactory>>
) => useService(useApplicationLifecycleFactory)(...args);
