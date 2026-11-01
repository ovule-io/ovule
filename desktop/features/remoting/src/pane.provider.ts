import remotingTokens from "./remoting.token";
import type { Register } from "@ovule/ioc";
import { spiceSessionPaneDefinition } from "./pane";
export default function register(register: Register): void {
  registerPane(register);
}

function registerPane(register: Register): void {
  register(remotingTokens.paneDefinition, (dependsOn) => spiceSessionPaneDefinition);
}
