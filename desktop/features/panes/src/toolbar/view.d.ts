import type { ComponentType } from "react";

import type { PaneInstance } from "@ovule/panes/tab";

export type ToolbarViewProps = {
  tabs: PaneInstance[];
  active?: PaneInstance;
  threadId?: string;
  draftId?: string;
  className?: string;
};

export type PaneToolbarViewProps = ToolbarViewProps & { workbench?: boolean };
export type ToolbarView = ComponentType<ToolbarViewProps>;

export type TabFaviconViewProps = { tab: PaneInstance };

export type PaneToolbarViewTokenValue = ComponentType<PaneToolbarViewProps>;

export type TabFaviconViewTokenValue = ComponentType<TabFaviconViewProps>;
