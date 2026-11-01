import { createToken, tokens } from "@ovule/ioc";
import type { PaneDefinition } from "@ovule/panes/pane";
import type { TerminalStateService, TerminalStateController } from "./state";

export default tokens({
  paneDefinition: createToken<PaneDefinition>("terminalPaneDefinition"),
  stateController: createToken<TerminalStateController>("TerminalStateController"),
  terminalState: createToken<TerminalStateService>("TerminalStateService"),
});
