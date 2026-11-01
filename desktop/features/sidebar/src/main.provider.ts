import tokens from "./sidebar.token";
import { type Register } from "@ovule/ioc";
import { SidebarFactory } from "./Sidebar";
export default function register(register: Register): void {
  register(tokens.sidebarView, (dependsOn) => dependsOn(SidebarFactory));
}
