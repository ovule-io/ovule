import { lazy } from "react";

import type { PaneDefinition } from "@ovule/panes/pane";

const LocalFilesPanel = lazy(() =>
  import("./LocalFilesPanel").then((module) => ({
    default: module.LocalFilesPanel,
  })),
);

export const localFilesPaneDefinition: PaneDefinition = {
  kind: "files",
  component: (context) => <LocalFilesPanel {...context} />,
};
