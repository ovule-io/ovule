import { paneWorkspacePath } from "../pane-workspace";
import { lazy } from "react";

import type { PaneDefinition } from "@ovule/panes/pane";

const MarkdownPanel = lazy(() =>
  import("./MarkdownPanel").then((module) => ({
    default: module.MarkdownPanel,
  })),
);

export const markdownPaneDefinition: PaneDefinition = {
  kind: "markdown",
  component: (context) => (
    <MarkdownPanel
      paneId={context.id}
      threadId={context.thread?.id}
      workspacePath={paneWorkspacePath(context)}
      initialPath={context.target}
    />
  ),
};
