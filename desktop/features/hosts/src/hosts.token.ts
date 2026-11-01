import { createToken, tokens } from "@ovule/ioc";
import type { HostsViewStateService } from "./hosts";
import type { HostsStateService, HostsStateController } from "./state";

export default tokens({
  hostsViewState: createToken<HostsViewStateService>("HostsViewState"),
  stateController: createToken<HostsStateController>("HostsStateController"),
  hostsState: createToken<HostsStateService>("HostsStateService"),
});
