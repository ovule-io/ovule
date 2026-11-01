import shellTokens from "@ovule/shell/shell.token";
import { create } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Tooltip } from "@ovule/ui/tooltip";
import { Maximize2, Minimize2 } from "lucide-react";
import type { ToolbarViewProps } from "./view";
import { PaneToolbarFrame } from "./PaneToolbarFrame";
import { ToolbarRoot, AddTabButton } from "./ToolbarControls";
import {
  WorkbenchTabIndicators,
  WorkbenchActiveTab,
  WorkbenchTabMenu,
} from "./WorkbenchToolbarTabs";
import { useToolbarModel, type ToolbarModel } from "./useToolbarModel";
import styles from "./PaneToolbar.module.css";

function WorkbenchToolbar(props: ToolbarViewProps) {
  const model = useToolbarModel(props, "workbench");
  const { DownloadsButton } = useService(shellTokens.routeRuntime);
  return (
    <ToolbarRoot model={model}>
      <PaneToolbarFrame
        variant="workbench"
        tabIndicators={
          model.tabs.some((tab) => tab.id !== model.active?.id) ? (
            <WorkbenchTabIndicators model={model} />
          ) : undefined
        }
        addTab={<AddTabButton model={model} />}
        activeTab={<WorkbenchActiveTab model={model} />}
        tabOverlay={<WorkbenchTabMenu model={model} />}
        trailingActions={
          <>
            <DownloadsButton className={styles.titlebarButton} />
            <ExpandWorkbench model={model} />
          </>
        }
      />
    </ToolbarRoot>
  );
}
export const WorkbenchToolbarFactory = create(() => WorkbenchToolbar, "WorkbenchToolbar");
function ExpandWorkbench({ model }: { model: ToolbarModel }) {
  const { i18n } = useTranslation();
  const { expanded, layout: layoutService } = model;
  return (
    <Tooltip
      side="bottom"
      align="end"
      content={
        expanded
          ? i18n.t("explorerTitlebar.restorePanelWidth")
          : i18n.t("explorerTitlebar.expandPanel")
      }
    >
      <Button
        size="sm"
        className={styles.titlebarButton}
        aria-label={
          expanded
            ? i18n.t("explorerTitlebar.restorePanelWidth")
            : i18n.t("explorerTitlebar.expandPanel")
        }
        onClick={layoutService.toggleWorkbenchExpanded}
      >
        {expanded ? (
          <Minimize2 className={styles.titlebarIcon} />
        ) : (
          <Maximize2 className={styles.titlebarIcon} />
        )}
      </Button>
    </Tooltip>
  );
}
