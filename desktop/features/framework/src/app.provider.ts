import tokens from "./framework.token";
import { value, type Register } from "@ovule/ioc";
import { TitleBar } from "./titlebar/TitleBar";
export default function register(register: Register): void {
  register(tokens.routeRuntime, value({ TitleBar }));
}
