import { SpicePaneToolbar } from "./SpicePaneToolbar";
import { lazy } from "react";
import type { PaneDefinition } from "@ovule/panes/pane";

const SpiceSessionPanel = lazy(() =>
  import("./SpiceSessionPanel").then((module) => ({
    default: module.SpiceSessionPanel,
  })),
);

export const spiceSessionPaneDefinition: PaneDefinition = {
  kind: "spice",
  workspaceToolbar: SpicePaneToolbar,
  workbenchToolbar: SpicePaneToolbar,
  component: SpiceSessionPanel,
};
