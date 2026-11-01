import branding from "../../../../branding.json";
import sidebarTokens from "@ovule/sidebar/sidebar.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import settingsTokens from "@ovule/settings/settings.token";
import browserTokens from "@ovule/browser/browser.token";
import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";

import { Toaster, toast } from "@ovule/ui/sonner";
import { Alert, AlertDescription, AlertTitle } from "@ovule/ui/alert";
import { Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { useService } from "@ovule/ioc/react";

import { useServiceState } from "@ovule/ioc/react";
import { DesktopStateFactory } from "../state";
import type { AppSnapshot } from "@ovule/shell-api";

export type MainOverlayRenderState = {
  setupOpen: boolean;
  setup: ReactNode;
  closeSetup(): void;
};

type Props = {
  snapshot: AppSnapshot;
  threadId?: string;
  children(state: MainOverlayRenderState): ReactNode;
};

export function MainOverlayHost({ snapshot, threadId, children }: Props) {
  const { ExplorerOverlay } = useService(browserTokens.routeRuntime);
  const { GlobalDialogHost } = useService(conversationTokens.messageTelemetryRouteRuntime);
  const { OnboardingPage } = useService(settingsTokens.routeRuntime);
  const { ThreadSwitcherDialog } = useService(sidebarTokens.threadSwitcherRouteRuntime);
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("ovule.onboarding.dismissed") === "true",
  );
  const overlays = useService(frameworkTokens.mainOverlay);
  const overlayState = useServiceState(frameworkTokens.mainOverlay, (state) => state);
  const runtime = useService(DesktopStateFactory);
  const selection = useService(conversationTokens.selection);
  const layout = useService(frameworkTokens.frameworkLayout);
  const tabs = useServiceState(panesTokens.panes, (state) => state.instances);
  const draftId = useServiceState(panesTokens.panes, (state) => state.draftConversationId);
  const expanded = useServiceState(
    frameworkTokens.frameworkLayout,
    (state) => state.workbenchExpanded,
  );
  useEffect(() => {
    for (const tabId of Object.keys(overlayState.explorerTabs)) {
      if (!tabs.some((tab) => tab.id === tabId)) overlays.releaseExplorerTab(tabId);
    }
  }, [tabs, overlayState.explorerTabs, overlays]);
  const onboardingOpen =
    overlayState.onboardingRequested || (snapshot.threads.length === 0 && !onboardingDismissed);

  useLayoutEffect(() => {
    if (
      (onboardingOpen || overlayState.settingsOpen || overlayState.remoteWorkspacesOpen) &&
      layout.current().workbenchExpanded
    )
      layout.toggleWorkbenchExpanded();
  }, [onboardingOpen, overlayState.settingsOpen, overlayState.remoteWorkspacesOpen, layout]);

  const closeOnboarding = () => {
    localStorage.setItem("ovule.onboarding.dismissed", "true");
    setOnboardingDismissed(true);
    overlays.close("onboarding");
  };

  useEffect(() => {
    if (!overlayState.onboardingRequested) return;
    localStorage.removeItem("ovule.onboarding.dismissed");
    setOnboardingDismissed(false);
  }, [overlayState.onboardingRequested]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        overlays.open("threadSwitcher");
      }
    };
    const showNotification = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: unknown; body?: unknown }>).detail;
      const title = typeof detail?.title === "string" ? detail.title : branding.displayName;
      const body = typeof detail?.body === "string" ? detail.body : undefined;
      toast.custom(() => (
        <Alert>
          <AlertTitle>{title}</AlertTitle>
          {body && <AlertDescription>{body}</AlertDescription>}
        </Alert>
      ));
    };
    const openRemoteWorkspaces = () => overlays.open("remoteWorkspaces");
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("ovule:notification", showNotification);
    window.addEventListener("ovule:remote-workspaces-open", openRemoteWorkspaces);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("ovule:notification", showNotification);
      window.removeEventListener("ovule:remote-workspaces-open", openRemoteWorkspaces);
    };
  }, [overlays]);

  const setup = onboardingOpen ? (
    <Suspense fallback={null}>
      <OnboardingPage
        threadId={threadId}
        onComplete={() => {
          void runtime.load();
          closeOnboarding();
        }}
      />
    </Suspense>
  ) : null;

  return (
    <>
      {children({
        setupOpen: onboardingOpen,
        setup,
        closeSetup: closeOnboarding,
      })}
      {overlayState.threadSwitcherOpen && (
        <Suspense fallback={null}>
          <ThreadSwitcherDialog
            open
            threads={snapshot.threads.filter(
              (thread) => !snapshot.nodes.some((node) => node.threadId === thread.id),
            )}
            selectedThreadId={threadId}
            onSelectThread={selection.selectThread}
            onOpenChange={(open) =>
              open ? overlays.open("threadSwitcher") : overlays.close("threadSwitcher")
            }
          />
        </Suspense>
      )}
      {overlayState.explorer && (
        <Suspense fallback={null}>
          <ExplorerOverlay
            key={overlayState.explorer.id}
            request={overlayState.explorer}
            fallbackThreadId={threadId}
            fallbackDraftId={!threadId ? draftId : undefined}
            sidebarAvailable={
              !onboardingOpen &&
              !overlayState.settingsOpen &&
              !overlayState.remoteWorkspacesOpen &&
              !expanded
            }
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <GlobalDialogHost />
      </Suspense>
      <Toaster richColors closeButton position="bottom-right" />
    </>
  );
}
