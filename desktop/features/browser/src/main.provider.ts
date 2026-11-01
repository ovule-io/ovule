import browserTokens from "./browser.token";
import settingsTokens from "@ovule/settings/settings.token";
import frameworkTokens from "@ovule/framework/framework.token";
import panesTokens from "@ovule/panes/panes.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { createLinkService } from "./link-service";
import type { Register } from "@ovule/ioc";

export default function register(register: Register): void {
  register(browserTokens.links, (dependsOn) => {
    const workspace = dependsOn(workspaceTokens.workspace);
    return createLinkService({
      preferences: dependsOn(settingsTokens.preferences),
      overlays: dependsOn(frameworkTokens.mainOverlay),
      panes: dependsOn(panesTokens.panes),
      openSystem: async (url) => {
        await (await workspace.api()).openSystemUrl(url);
      },
    });
  });
}
