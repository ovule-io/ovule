import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { PaneKind } from "@ovule/panes/tab";
import type { PaneInstance } from "@ovule/panes/tab";
export interface RouteRuntime {
  PaneAddMenu: (props: ComponentProps<"div">) => ReactNode;
  addablePanes: ReadonlyArray<{
    kind: PaneKind;
    icon: LucideIcon;
    translationKey: string;
  }>;
  PaneToolbarFrame: (arg0: {
    variant?: "workspace" | "workbench";
    showDividers?: boolean;
    sidebarToggle?: ReactNode;
    tabIndicators?: ReactNode;
    addTab?: ReactNode;
    activeTab: ReactNode;
    tabOverlay?: ReactNode;
    trailingActions?: ReactNode;
    className?: string;
    activeTabSlotClassName?: string;
  }) => ReactNode;
  PaneTabIndicators: (arg0: { tabs: PaneInstance[]; onSelect(tabId: string): void }) => ReactNode;
  titlebarStyles: Readonly<Record<string, string>>;
}
