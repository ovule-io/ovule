import type { ComponentType, CSSProperties } from "react";
import type { PaneInstance } from "./tab";
export type PaneSurfaceViewProps = { tab: PaneInstance; active: boolean; style?: CSSProperties };
export type PaneSurfaceViewTokenValue = ComponentType<PaneSurfaceViewProps>;

export type NewTabAction = "files" | "terminal" | "workflow" | "spice";
export type NewTabViewProps = {
  tabId: string;
  active: boolean;
  threadId?: string;
  onNavigate(target: string): void;
  onOpenAction(kind: NewTabAction): Promise<unknown>;
};
export type NewTabView = ComponentType<NewTabViewProps>;
