import hostsTokens from "./hosts.token";
import type { Register } from "@ovule/ioc";
import { createHostsStateService } from "./state-service";
export default function register(register: Register): void {
  registerState(register);
}

function registerState(register: Register): void {
  register(hostsTokens.stateController, () => createHostsStateService());
  register(hostsTokens.hostsState, (dependsOn) => dependsOn(hostsTokens.stateController).service);
}
