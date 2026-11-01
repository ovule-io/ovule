import { createToken, tokens } from "@ovule/ioc";
import type { PaneDefinition } from "@ovule/panes/pane";
import type { RemoteControlService } from "./remoting";
import type { SessionLinksService } from "./session-links";

export default tokens({
  paneDefinition: createToken<PaneDefinition>("remotingPaneDefinition"),
  remoteControl: createToken<RemoteControlService>("RemoteControlService"),
  sessionLinks: createToken<SessionLinksService>("SessionLinksService"),
});
