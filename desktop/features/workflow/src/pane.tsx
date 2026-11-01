import type { WorkflowPresentation } from "@ovule/workflow/presentation/workflow-presentation";
import { lazy } from "react";

import type { PaneDefinition } from "@ovule/panes/pane";

const WorkflowPanel = lazy(() =>
  import("./WorkflowPanel").then((module) => ({
    default: module.WorkflowPanel,
  })),
);

export const workflowPaneDefinition = (presentation: WorkflowPresentation): PaneDefinition => ({
  kind: "workflow",
  component: (context) => (
    <WorkflowPanel
      presentation={presentation}
      nodes={context.nodes}
      goal={context.goal}
      invoke={context.invoke}
      busy={context.busy}
      openNodeThread={context.openNodeThread}
      snapshot={context.snapshot}
    />
  ),
});
