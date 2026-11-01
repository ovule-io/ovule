import tokens from "./workbench.token";
import type { Register } from "@ovule/ioc";
import { WorkbenchFactory } from "./Workbench";
export default function register(register: Register): void {
  register(tokens.workbenchView, (dependsOn) => dependsOn(WorkbenchFactory));
}
