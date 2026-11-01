import messagePartsTokens from "./message-parts.token";
import type { Register } from "@ovule/ioc";
import { handoffPaneDefinition } from "./handoff/pane";
export default function register(register: Register): void {
  registerPane(register);
}

function registerPane(register: Register): void {
  register(messagePartsTokens.paneDefinition, (dependsOn) => handoffPaneDefinition);
}
