import type { PreferencesService, LinkOpening } from "@ovule/settings/preferences/preferences";
import type { MainOverlayService } from "@ovule/framework/overlay/main-overlay";
import type { PanesService } from "@ovule/panes/panes";
import type { LinkService } from "./links";

export function createLinkService({
  preferences,
  overlays,
  panes,
  openSystem,
}: {
  preferences: Pick<PreferencesService, "current">;
  overlays: Pick<MainOverlayService, "openExplorer">;
  panes: Pick<PanesService, "openTab">;
  openSystem(url: string): Promise<void>;
}): LinkService {
  return {
    async open(request, mode: LinkOpening = preferences.current().linkOpening) {
      const url = new URL(request.target);
      if (!["http:", "https:", "file:"].includes(url.protocol)) return;
      if (mode === "system") {
        await openSystem(url.href);
      } else if (mode === "overlay") {
        overlays.openExplorer(request);
      } else {
        panes.openTab("browser", {
          target: url.href,
          threadId: request.threadId,
          placement: mode === "new-tab" && request.threadId ? "thread" : "workbench",
          newInstance: true,
          autoLoad: true,
          navigation: request.navigation,
        });
      }
    },
  };
}
