import type { ReactNode } from "react";
import { cn } from "@ovule/ui/cn";
import styles from "./PaneToolbar.module.css";

export function PaneToolbarFrame({
  variant = "workbench",
  showDividers = true,
  sidebarToggle,
  tabIndicators,
  addTab,
  activeTab,
  tabOverlay,
  trailingActions,
  className = "",
  activeTabSlotClassName = "",
}: {
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
}) {
  return (
    <header
      className={cn("topbar", "explorer-titlebar", styles.explorerTitlebar, className)}
      data-toolbar-variant={variant}
      data-workspace-titlebar
    >
      {sidebarToggle && (
        <>
          <div className={styles.titlebarSlot} data-titlebar-slot="sidebar-toggle">
            {sidebarToggle}
          </div>
          {showDividers && variant === "workbench" && (
            <span className={styles.paneDivider} data-titlebar-divider />
          )}
        </>
      )}
      <div className={cn("pane-tabs-region", styles.paneTabsRegion)} data-titlebar-region="tabs">
        {variant === "workbench" && tabIndicators && (
          <div className={styles.titlebarSlot} data-titlebar-slot="tab-indicators">
            {tabIndicators}
          </div>
        )}
        {addTab && (
          <div className={styles.titlebarSlot} data-titlebar-slot="add-tab">
            {addTab}
          </div>
        )}
        {showDividers && variant === "workspace" && addTab && (
          <span className={styles.paneDivider} data-titlebar-divider />
        )}
        <div
          className={cn(styles.titlebarSlot, styles.activeTabSlot, activeTabSlotClassName)}
          data-titlebar-slot="active-tab"
        >
          {activeTab}
        </div>
        {tabOverlay}
      </div>
      {trailingActions && (
        <>
          {showDividers && <span className={styles.paneDivider} data-titlebar-divider />}
          <div
            className={cn(styles.titlebarSlot, styles.trailingActionsSlot)}
            data-titlebar-slot="trailing-actions"
          >
            {trailingActions}
          </div>
        </>
      )}
    </header>
  );
}
