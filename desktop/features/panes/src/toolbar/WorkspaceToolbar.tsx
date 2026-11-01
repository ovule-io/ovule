import panesTokens from "@ovule/panes/panes.token";
import shellTokens from "@ovule/shell/shell.token";
import { create } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Tooltip } from "@ovule/ui/tooltip";
import { PanelLeft, SquareArrowOutUpRight } from "lucide-react";
import { cn } from "@ovule/ui/cn";
import type { ToolbarViewProps } from "./view";
import type { PaneRegistry } from "../pane";
import { PaneToolbarActions } from "./PaneToolbarActions";
import { PaneToolbarFrame } from "./PaneToolbarFrame";
import { ToolbarRoot, AddTabButton } from "./ToolbarControls";
import { ToolbarEditor } from "./ToolbarEditor";
import { useToolbarModel, type ToolbarModel } from "./useToolbarModel";
import styles from "./PaneToolbar.module.css";

export const WorkspaceToolbarFactory = create((dependsOn) => {
  const registry = dependsOn(panesTokens.paneRegistry);
  return function WorkspaceToolbar(props: ToolbarViewProps) {
    const model = useToolbarModel(props, "thread");
    return (
      <ToolbarRoot model={model}>
        <PaneToolbarFrame
          variant="workspace"
          sidebarToggle={<SidebarToggle model={model} />}
          addTab={<AddTabButton model={model} />}
          activeTab={<WorkspacePaneToolbar model={model} registry={registry} />}
          trailingActions={model.active && <OpenInWorkbench model={model} />}
        />
      </ToolbarRoot>
    );
  };
}, "WorkspaceToolbar");
function SidebarToggle({ model }: { model: ToolbarModel }) {
  const { t } = useTranslation();
  const { sidebarOpen, layout: layoutService } = model;
  return (
    <Tooltip
      side="bottom"
      align="start"
      content={t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")}
    >
      <Button
        size="sm"
        className={styles.titlebarButton}
        aria-label={t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")}
        onClick={layoutService.toggleSidebar}
      >
        <PanelLeft />
      </Button>
    </Tooltip>
  );
}
function OpenInWorkbench({ model }: { model: ToolbarModel }) {
  const { i18n } = useTranslation();
  const { active, explorer: workbenchService } = model;
  if (!active) return null;
  return (
    <Tooltip side="bottom" align="end" content={i18n.t("explorerTitlebar.openInWorkbench")}>
      <Button
        size="sm"
        className={styles.titlebarButton}
        aria-label={i18n.t("explorerTitlebar.openInWorkbench")}
        onClick={() => workbenchService.moveTabToWorkbench(active.id)}
      >
        <SquareArrowOutUpRight className={styles.titlebarIcon} />
      </Button>
    </Tooltip>
  );
}
function WorkspacePaneToolbar({
  model,
  registry,
}: {
  model: ToolbarModel;
  registry: PaneRegistry;
}) {
  const { DownloadsButton } = useService(shellTokens.routeRuntime);
  const { active, editing, paneCommand, startEditing, copyAddress, startSearch } = model;
  const downloads = <DownloadsButton className={styles.titlebarButton} />;
  const RegisteredToolbar = registry
    .list()
    .find((pane) => pane.kind === active?.kind)?.workspaceToolbar;
  return active && RegisteredToolbar ? (
    <RegisteredToolbar
      tab={active}
      command={paneCommand}
      startEditing={startEditing}
      copyAddress={copyAddress}
      editing={editing}
      addressEditor={editing ? <ToolbarEditor model={model} selectOnFocus /> : null}
      downloads={downloads}
    />
  ) : (
    <div className={styles.workspacePaneToolbar}>
      {editing ? (
        <ToolbarEditor model={model} selectOnFocus />
      ) : (
        <>
          <span className={cn(styles.paneText, styles.workspacePaneTitle)}>{active?.title}</span>
          {active && (
            <PaneToolbarActions tab={active} command={paneCommand} startSearch={startSearch} />
          )}
        </>
      )}
    </div>
  );
}
