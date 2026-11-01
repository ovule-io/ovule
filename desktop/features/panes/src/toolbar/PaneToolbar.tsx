import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import type { PaneToolbarViewProps } from "./view";
import { WorkspaceToolbarFactory } from "./WorkspaceToolbar";
import { WorkbenchToolbarFactory } from "./WorkbenchToolbar";

export const PaneToolbarFactory = create((dependsOn) => {
  const WorkspaceToolbar = dependsOn(WorkspaceToolbarFactory);
  const WorkbenchToolbar = dependsOn(WorkbenchToolbarFactory);
  return function PaneToolbar({ workbench, ...props }: PaneToolbarViewProps) {
    return createElement(workbench ? WorkbenchToolbar : WorkspaceToolbar, props);
  };
}, "PaneToolbar");

export const PaneToolbar = (...args: Parameters<ServiceOf<typeof PaneToolbarFactory>>) =>
  createElement(useService(PaneToolbarFactory), ...args);
