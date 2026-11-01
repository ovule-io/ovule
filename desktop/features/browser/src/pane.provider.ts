import browserTokens from "./browser.token";
import type { Register } from "@ovule/ioc";
import { browserPaneDefinition } from "./pane";
export default function register(register: Register): void {
  registerPane(register);
}

function registerPane(register: Register): void {
  register(browserTokens.paneDefinition, (dependsOn) => browserPaneDefinition);
}
