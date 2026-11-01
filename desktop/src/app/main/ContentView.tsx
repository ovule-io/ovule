import settingsTokens from "@ovule/settings/settings.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { useService } from "@ovule/ioc/react";
import { useServiceState } from "@ovule/ioc/react";
import { DesktopStateFactory } from "../state";

export function ContentView() {
  const SettingsPanel = useService(settingsTokens.settingsPanelView);
  const runtime = useService(DesktopStateFactory);
  const runtimeState = useServiceState(DesktopStateFactory, (state) => state);
  const overlayState = useServiceState(frameworkTokens.mainOverlay, (state) => state);
  const workbenchOpen = useServiceState(
    frameworkTokens.frameworkLayout,
    (state) => state.workbenchOpen,
  );
  const snapshot = runtimeState.snapshot;
  if (!snapshot || (!overlayState.settingsOpen && !overlayState.remoteWorkspacesOpen)) return null;

  const hostsOpen = overlayState.remoteWorkspacesOpen;
  return (
    <section
      className="h-full min-h-0 overflow-hidden bg-(--background)"
      data-framework-content={hostsOpen ? "hosts" : "settings"}
    >
      <SettingsPanel
        className="h-full min-h-0"
        snapshot={snapshot}
        busy={runtimeState.busy}
        invoke={runtime.invoke}
        initialSection={hostsOpen ? "hosts" : "general"}
        compactSidebar={workbenchOpen}
      />
    </section>
  );
}
