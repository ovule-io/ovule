import tokens from "./panes.token";
import terminalTokens from "@ovule/terminal/terminal.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { create, value, type Register } from "@ovule/ioc";
import type { PanesOptions } from "./panes-options";
import { createPanesService } from "./service";
import { PaneSurfaceFactory } from "./PaneSurface";
import { WorkspaceToolbarFactory } from "./toolbar/WorkspaceToolbar";
import { WorkbenchToolbarFactory } from "./toolbar/WorkbenchToolbar";
import { PaneToolbarFactory } from "./toolbar/PaneToolbar";
import { TabFavicon } from "./toolbar/TabFavicon";
export default function register(
  register: Register,
  options: { overrides?: PanesOptions } = {},
): void {
  {
    const overrides = options.overrides ?? {};
    const State = create(
      (dependsOn) =>
        createPanesService({
          terminal: dependsOn(terminalTokens.terminalState),
          layout: dependsOn(frameworkTokens.frameworkLayout),
          storage:
            overrides.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage),
          createId: overrides.createId,
        }),
      "PaneState",
    );
    register(tokens.panes, (dependsOn) => dependsOn(State));
    register(tokens.tabFaviconView, value(TabFavicon));
    register(tokens.workspaceToolbarView, (dependsOn) => dependsOn(WorkspaceToolbarFactory));
    register(tokens.workbenchToolbarView, (dependsOn) => dependsOn(WorkbenchToolbarFactory));
    register(tokens.paneToolbarView, (dependsOn) => dependsOn(PaneToolbarFactory));
    register(tokens.paneSurfaceView, (dependsOn) => dependsOn(PaneSurfaceFactory));
  }
}
