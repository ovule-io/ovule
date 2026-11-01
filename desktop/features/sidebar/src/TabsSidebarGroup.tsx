import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Trash2 } from "lucide-react";
import { Button } from "@ovule/ui/button";
import { Tooltip } from "@ovule/ui/tooltip";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@ovule/ui/sidebar";
import type { PaneInstance } from "@ovule/panes/tab";
import { ArtifactTabs, type ThreadTreeModel } from "./ThreadSidebarItem";
import styles from "./ChatSidebar.module.css";

export function TabsSidebarGroup({
  tabs,
  draftId,
  model,
}: {
  tabs: PaneInstance[];
  draftId: string;
  model: ThreadTreeModel;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const sidebarTabs = tabs.filter((tab) => tab.placement === "thread");
  if (!sidebarTabs.length) return null;
  const clearable = sidebarTabs.filter(model.canClose);
  const toggleLabel = t(expanded ? "sidebar.collapseTabGroup" : "sidebar.expandTabGroup");
  return (
    <SidebarGroup data-sidebar-tabs>
      <div className={styles.tabsGroupHeader}>
        <SidebarGroupLabel className={styles.tabsGroupLabel}>{t("sidebar.tabs")}</SidebarGroupLabel>
        <Tooltip className={styles.tabsClearAction} side="bottom" content={t("sidebar.clearTabs")}>
          <Button
            className={styles.groupIconButton}
            variant="ghost"
            size="sm"
            aria-label={t("sidebar.clearTabs")}
            disabled={!clearable.length}
            onClick={() => clearable.forEach((tab) => model.closeTab(tab.id))}
          >
            <Trash2 size={14} />
          </Button>
        </Tooltip>
        <Tooltip side="bottom" content={toggleLabel}>
          <Button
            className={styles.groupIconButton}
            variant="ghost"
            size="sm"
            aria-label={toggleLabel}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRight size={14} className={expanded ? styles.expandedChevron : undefined} />
          </Button>
        </Tooltip>
      </div>
      <SidebarGroupContent className={styles.tabsGroupContent} id={contentId} hidden={!expanded}>
        <ArtifactTabs tabs={sidebarTabs} ownerId={draftId} model={model} nested={false} />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
