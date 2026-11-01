import { lazy } from "react";

import type { PaneDefinition } from "@ovule/panes/pane";

const TerminalPanel = lazy(() =>
  import("./TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);

export const terminalPaneDefinition: PaneDefinition = {
  kind: "terminal",
  component: (context) => {
    const binding = context.workspaceBindingId
      ? context.snapshot.bindings.find((item) => item.id === context.workspaceBindingId)
      : undefined;
    return (
      <TerminalPanel
        threadId={context.thread?.id}
        workspacePath={
          binding?.root ?? (context.useThreadWorkspace ? context.thread?.workspacePath : undefined)
        }
        workspaceBindingId={context.workspaceBindingId}
        useThreadWorkspace={context.useThreadWorkspace}
        instanceId={context.id}
        runs={context.snapshot.terminalRuns}
        invoke={context.invoke}
      />
    );
  },
};
