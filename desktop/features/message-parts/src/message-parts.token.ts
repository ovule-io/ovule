import { createToken, tokens } from "@ovule/ioc";
import type { MessagePartsRuntime } from "./message-parts";

import type { HandoffProtocolService } from "./handoff/protocol";
import type { RouteRuntime } from "./handoff/route";
import type { PaneDefinition } from "@ovule/panes/pane";
export default tokens({
  handoffProtocol: createToken<HandoffProtocolService>("HandoffProtocolService"),
  routeRuntime: createToken<RouteRuntime>("handoffRouteRuntime"),
  paneDefinition: createToken<PaneDefinition>("handoffPaneDefinition"),
  runtime: createToken<MessagePartsRuntime>("MessagePartsRuntime"),
});
