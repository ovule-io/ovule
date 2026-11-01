import { createToken, tokens } from "@ovule/ioc";
import type { PaneRegistry } from "./pane";
import type { PanesService } from "./panes";
import type { RouteRuntime } from "./toolbar/route";
import type {
  PaneToolbarViewTokenValue,
  TabFaviconViewTokenValue,
  ToolbarView,
} from "./toolbar/view";
import type { NewTabView, PaneSurfaceViewTokenValue } from "./view";
export default tokens({
  newTabView: createToken<NewTabView>("NewTabView"),
  paneRegistry: createToken<PaneRegistry>("PaneRegistry"),
  panes: createToken<PanesService>("PanesService"),
  routeRuntime: createToken<RouteRuntime>("paneToolbarRouteRuntime"),
  workspaceToolbarView: createToken<ToolbarView>("WorkspaceToolbarView"),
  workbenchToolbarView: createToken<ToolbarView>("WorkbenchToolbarView"),
  paneToolbarView: createToken<PaneToolbarViewTokenValue>("PaneToolbarView"),
  tabFaviconView: createToken<TabFaviconViewTokenValue>("TabFaviconView"),
  paneSurfaceView: createToken<PaneSurfaceViewTokenValue>("PaneSurfaceView"),
});
