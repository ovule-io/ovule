import { lazy } from "react";
import type { PaneDefinition } from "@ovule/panes/pane";

const HandoffPanel = lazy(() =>
  import("./HandoffPanel").then((module) => ({ default: module.HandoffPanel })),
);

export const handoffPaneDefinition: PaneDefinition = {
  kind: "handoff",
  component: HandoffPanel,
};
