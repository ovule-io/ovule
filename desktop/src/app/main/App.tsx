import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import { useApplicationLifecycle } from "../shared/useApplicationLifecycle";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";

import { DesktopStateFactory } from "../state";
import { useServiceState } from "@ovule/ioc/react";
import { MainOverlayHost } from "./MainOverlayHost";

export function App() {
  const { TitleBar } = useService(frameworkTokens.routeRuntime);
  useApplicationLifecycle();
  const { t } = useTranslation();
  const Framework = useService(frameworkTokens.frameworkView);
  const runtime = useServiceState(DesktopStateFactory, (state) => state);
  const snapshot = runtime.snapshot;
  const selection = useService(conversationTokens.selection);
  const selectedThreadId = useServiceState(
    conversationTokens.selection,
    (state) => state.selectedThreadId,
  );
  const layout = useService(frameworkTokens.frameworkLayout);
  const panes = useService(panesTokens.panes);
  const overlays = useService(frameworkTokens.mainOverlay);
  const overlayState = useServiceState(frameworkTokens.mainOverlay, (state) => state);
  const workbenchOpen = useServiceState(
    frameworkTokens.frameworkLayout,
    (state) => state.workbenchOpen,
  );
  const openContentSurface = (target: "settings" | "remoteWorkspaces") => {
    const active =
      target === "settings" ? overlayState.settingsOpen : overlayState.remoteWorkspacesOpen;
    if (active) overlays.close(target);
    else overlays.open(target);
    if (layout.current().workbenchExpanded) layout.toggleWorkbenchExpanded();
  };
  const thread =
    selectedThreadId === ""
      ? undefined
      : (snapshot?.threads.find((item) => item.id === selectedThreadId) ?? snapshot?.threads[0]);

  if (!snapshot) {
    return (
      <main className="app-shell grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[36px_minmax(0,1fr)] overflow-hidden rounded-xl bg-(--app-background) [background-image:var(--app-background-image)] backdrop-blur-[28px] backdrop-saturate-[1.35]">
        <TitleBar
          key="boot-titlebar"
          title=""
          workbenchOpen={false}
          onToggleWorkbench={() => undefined}
          onOpenSettings={() => undefined}
          onOpenOnboarding={() => undefined}
          showWorkspaceActions={false}
          showSettings={false}
          showOnboarding={false}
        />
        {runtime.error ? (
          <section className="grid min-h-screen place-content-center justify-items-center gap-3 bg-(--background) text-(--muted-foreground)">
            <div className="max-w-[680px] rounded-xl border border-(--danger) bg-(--surface) p-[26px] text-(--danger)">
              <h1 className="mt-0 mb-2.5 text-(--text)">{t("fatal.workspace")}</h1>
              <p>{t("fatal.snapshot")}</p>
              <pre className="overflow-auto bg-(--surface-2) p-3 whitespace-pre-wrap text-(--text)">
                {runtime.error}
              </pre>
            </div>
          </section>
        ) : (
          <section className="grid min-h-screen place-content-center justify-items-center gap-3 bg-(--background) text-(--muted-foreground)">
            <LoaderCircle className="animate-spin" /> {t("fatal.loading")}
          </section>
        )}
      </main>
    );
  }
  return (
    <main className="app-shell grid h-screen grid-cols-[minmax(0,1fr)] grid-rows-[36px_minmax(0,1fr)] overflow-hidden rounded-xl bg-(--app-background) [background-image:var(--app-background-image)] backdrop-blur-[28px] backdrop-saturate-[1.35]">
      <MainOverlayHost snapshot={snapshot} threadId={thread?.id}>
        {(overlayView) => (
          <>
            <TitleBar
              key="workspace-titlebar"
              title={thread?.title ?? ""}
              workbenchOpen={workbenchOpen}
              onBackToChat={() => {
                overlayView.closeSetup();
                overlays.close("settings");
                overlays.close("remoteWorkspaces");
                overlays.closeExplorer();
                layout.closeWorkbench();
              }}
              onToggleWorkbench={() =>
                workbenchOpen ? layout.closeWorkbench() : layout.openWorkbench()
              }
              onOpenSettings={() => {
                overlayView.closeSetup();
                openContentSurface("settings");
              }}
              settingsOpen={overlayState.settingsOpen || overlayState.remoteWorkspacesOpen}
              onboardingOpen={overlayView.setupOpen}
              onOpenOnboarding={() => {
                if (overlayView.setupOpen) {
                  overlayView.closeSetup();
                  return;
                }
                overlays.close("settings");
                overlays.close("remoteWorkspaces");
                overlays.open("onboarding");
              }}
            />
            <Framework
              onOpenThreadSwitcher={() => overlays.open("threadSwitcher")}
              onNewThread={() => {
                overlays.close("settings");
                overlays.close("remoteWorkspaces");
                layout.closeWorkbench();
                selection.clearThread();
                panes.selectThreadArtifact(panes.current().draftConversationId);
              }}
              setupOpen={overlayView.setupOpen}
              setup={overlayView.setup}
            />
          </>
        )}
      </MainOverlayHost>
    </main>
  );
}
