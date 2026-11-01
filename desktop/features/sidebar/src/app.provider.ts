import tokens from "./sidebar.token";
import { value, type Register } from "@ovule/ioc";
import { lazy } from "react";
export default function register(register: Register): void {
  register(
    tokens.threadSwitcherRouteRuntime,
    value({
      ThreadSwitcherDialog: lazy(() =>
        import("./thread-switcher/ThreadSwitcherDialog").then((module) => ({
          default: module.ThreadSwitcherDialog,
        })),
      ),
    }),
  );
}
