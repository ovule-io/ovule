import terminalTokens from "./terminal.token";
import type { Register } from "@ovule/ioc";
import { terminalPaneDefinition } from "./pane";
export default function register(register: Register): void {
  registerPane(register);
}

function registerPane(register: Register): void {
  register(terminalTokens.paneDefinition, (dependsOn) => terminalPaneDefinition);
}
