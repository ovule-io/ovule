import terminalTokens from "./terminal.token";
import type { Register } from "@ovule/ioc";
import { createTerminalStateService } from "./state-service";
export default function register(register: Register): void {
  registerState(register);
}

function registerState(register: Register): void {
  register(terminalTokens.stateController, () => createTerminalStateService());
  register(
    terminalTokens.terminalState,
    (dependsOn) => dependsOn(terminalTokens.stateController).service,
  );
}
