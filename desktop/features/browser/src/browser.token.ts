import { createToken, tokens } from "@ovule/ioc";
import type { PaneDefinition } from "@ovule/panes/pane";
import type { RouteRuntime } from "./route";
import type { LinkService } from "./links";

export default tokens({
  links: createToken<LinkService>("LinkService"),
  paneDefinition: createToken<PaneDefinition>("browserPaneDefinition"),
  routeRuntime: createToken<RouteRuntime>("browserRouteRuntime"),
});
