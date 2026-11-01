import { paneWorkspacePath } from "../pane-workspace";
import { lazy } from "react";

import type { PaneDefinition } from "@ovule/panes/pane";

const FileEditorPanel = lazy(() =>
  import("./FileEditorPanel").then((module) => ({
    default: module.FileEditorPanel,
  })),
);

export const fileEditorPaneDefinition: PaneDefinition = {
  kind: "office",
  component: (context) => (
    <FileEditorPanel
      threadId={context.thread?.id}
      workspacePath={paneWorkspacePath(context)}
      initialPath={context.target}
    />
  ),
};
