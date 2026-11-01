import { createToken, tokens } from "@ovule/ioc";
import type { SidebarViewTokenValue } from "./view";

import type { RouteRuntime } from "./thread-switcher/route";
export default tokens({
  threadSwitcherRouteRuntime: createToken<RouteRuntime>("threadSwitcherRouteRuntime"),
  sidebarView: createToken<SidebarViewTokenValue>("SidebarView"),
});
