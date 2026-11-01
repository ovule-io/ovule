import { createToken, tokens } from "@ovule/ioc";
import type { ConnectedAppsViewTokenValue } from "./view";

export default tokens({
  connectedAppsView: createToken<ConnectedAppsViewTokenValue>("ConnectedAppsView"),
});
