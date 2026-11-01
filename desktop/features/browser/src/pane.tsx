import { BrowserWorkspaceToolbar } from "./BrowserWorkspaceToolbar";
import { lazy } from "react";

import type { PaneDefinition } from "@ovule/panes/pane";

const BrowserPanel = lazy(() =>
  import("./BrowserPanel").then((module) => ({ default: module.BrowserPanel })),
);

export const browserPaneDefinition: PaneDefinition = {
  kind: "browser",
  workspaceToolbar: BrowserWorkspaceToolbar,
  component: (context) => (
    <BrowserPanel
      threadId={context.thread?.id}
      workspacePath={context.thread?.workspacePath}
      initialTarget={context.target}
      autoLoad={Boolean(context.target)}
      requestVersion={context.requestVersion}
      chrome={false}
      tabId={context.id}
    />
  ),
};
