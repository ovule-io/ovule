import tokens from "./panes.token";
import { value, type Register } from "@ovule/ioc";
import { addablePanes } from "./toolbar/paneIcons";
import { PaneAddMenu } from "./toolbar/PaneAddMenu";
import { PaneToolbarFrame } from "./toolbar/PaneToolbarFrame";
import { PaneTabIndicators } from "./toolbar/PaneTabIndicators";
import titlebarStyles from "./toolbar/PaneToolbar.module.css";
export default function register(register: Register): void {
  register(
    tokens.routeRuntime,
    value({ addablePanes, PaneAddMenu, PaneToolbarFrame, PaneTabIndicators, titlebarStyles }),
  );
}
