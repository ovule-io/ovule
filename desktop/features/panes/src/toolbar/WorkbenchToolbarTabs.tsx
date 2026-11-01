import panesTokens from "@ovule/panes/panes.token";
import { useService } from "@ovule/ioc/react";
import { BrowserWorkbenchActions } from "./BrowserWorkbenchActions";
import { useTranslation } from "react-i18next";
import { Avatar } from "@ovule/ui/data-display";
import { AvatarGroup, AvatarGroupCount } from "@ovule/ui/controls";
import { Button } from "@ovule/ui/button";
import { Tooltip } from "@ovule/ui/tooltip";
import { X } from "lucide-react";
import { cn } from "@ovule/ui/cn";
import { TabFavicon } from "./TabFavicon";
import { PaneToolbarActions } from "./PaneToolbarActions";
import { CloseTabButton } from "./ToolbarControls";
import { ToolbarEditor } from "./ToolbarEditor";
import { recentTabs, TAB_INDICATOR_LIMIT } from "./recent-tabs";
import type { ToolbarModel } from "./useToolbarModel";
import styles from "./PaneToolbar.module.css";

export function WorkbenchTabIndicators({ model }: { model: ToolbarModel }) {
  const { tabs, active, selectTab, listOpen, setListOpen } = model;
  const others = recentTabs(tabs.filter((tab) => tab.id !== active?.id));
  const { i18n } = useTranslation();
  return others.length ? (
    <AvatarGroup className={styles.paneTabIcons}>
      {others.slice(0, TAB_INDICATOR_LIMIT).map((tab) => (
        <Tooltip key={tab.id} side="bottom" content={tab.title}>
          <Avatar className={styles.paneTabAvatar}>
            <Button
              size="sm"
              className={cn(styles.titlebarButton, styles.paneTabButton)}
              aria-label={tab.title}
              onClick={() => selectTab(tab.id)}
            >
              <TabFavicon tab={tab} className={styles.paneAvatarFavicon} />
            </Button>
          </Avatar>
        </Tooltip>
      ))}
      {others.length > TAB_INDICATOR_LIMIT && (
        <Tooltip side="bottom" content={i18n.t("explorerTitlebar.showAllTabs")}>
          <Avatar className={cn(styles.paneTabAvatar, styles.paneCountAvatar)}>
            <Button
              size="sm"
              className={cn(styles.titlebarButton, styles.paneTabButton)}
              aria-label={i18n.t("explorerTitlebar.showAllTabs")}
              onClick={() => setListOpen(!listOpen)}
            >
              <AvatarGroupCount className={styles.paneCount}>
                +{others.length - TAB_INDICATOR_LIMIT}
              </AvatarGroupCount>
            </Button>
          </Avatar>
        </Tooltip>
      )}
    </AvatarGroup>
  ) : undefined;
}
export function WorkbenchActiveTab({ model }: { model: ToolbarModel }) {
  const { active, listOpen, setListOpen } = model;
  const { i18n } = useTranslation();
  const registry = useService(panesTokens.paneRegistry);
  const RegisteredToolbar = registry
    .list()
    .find((pane) => pane.kind === active?.kind)?.workbenchToolbar;
  if (active && RegisteredToolbar)
    return (
      <div className={styles.workspacePaneToolbar}>
        <Button
          size="sm"
          className={styles.titlebarButton}
          aria-label={i18n.t("explorerTitlebar.showAllTabs")}
          aria-expanded={listOpen}
          onClick={() => setListOpen(!listOpen)}
        >
          <TabFavicon tab={active} />
        </Button>
        <RegisteredToolbar tab={active} command={model.paneCommand} />
        <CloseTabButton model={model} />
      </div>
    );
  if (model.editing) return <ToolbarEditor model={model} />;
  return (
    <div className={cn("pane-active-tab", styles.paneActiveTab)}>
      <Button
        size="sm"
        className={cn(styles.titlebarButton, styles.paneActiveTabTrigger)}
        aria-label={i18n.t("explorerTitlebar.showAllTabs")}
        aria-expanded={listOpen}
        onClick={() => setListOpen(!listOpen)}
      >
        {active && <TabFavicon tab={active} className={styles.paneActiveFavicon} />}
        <span className={styles.paneActiveTabText}>
          <strong className={cn(styles.paneText, styles.paneTitle, styles.paneActiveTabTitle)}>
            {active?.title ?? i18n.t("workbench.workbench")}
          </strong>
          {active &&
            ["browser", "markdown", "files", "office"].includes(active.kind) &&
            (active.url || active.target) && (
              <small className={cn(styles.paneText, styles.paneSubtitle)}>
                {active.url ?? active.target}
              </small>
            )}
        </span>
      </Button>
      {active && (
        <div className={styles.paneActiveTabActions}>
          <WorkbenchPaneActions model={model} />
          <CloseTabButton model={model} />
        </div>
      )}
    </div>
  );
}
function WorkbenchPaneActions({ model }: { model: ToolbarModel }) {
  if (!model.active) return null;
  const Actions = workbenchActions[model.active.kind] ?? DefaultWorkbenchActions;
  return <Actions model={model} />;
}
function DefaultWorkbenchActions({ model }: { model: ToolbarModel }) {
  return (
    model.active && (
      <PaneToolbarActions
        tab={model.active}
        command={model.paneCommand}
        startSearch={model.startSearch}
      />
    )
  );
}
const workbenchActions: Partial<
  Record<NonNullable<ToolbarModel["active"]>["kind"], typeof BrowserWorkbenchActions>
> = {
  browser: BrowserWorkbenchActions,
};

export function WorkbenchTabMenu({ model }: { model: ToolbarModel }) {
  const { tabs, active, selectTab, setListOpen, canClose, explorer: workbenchService } = model;
  const { t, i18n } = useTranslation();
  if (!model.listOpen) return null;
  return (
    <div
      className={cn("pane-tabs-dropdown", styles.paneDropdown, styles.paneTabsDropdown)}
      role="menu"
      aria-label={i18n.t("explorerTitlebar.allTabs")}
    >
      {recentTabs(tabs).map((tab) => (
        <div
          role="menuitem"
          tabIndex={0}
          className={cn(
            "pane-menu-row",
            styles.paneMenuRow,
            tab.id === active?.id && styles.selected,
          )}
          key={tab.id}
          onClick={() => {
            selectTab(tab.id);
            setListOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectTab(tab.id);
              setListOpen(false);
            }
          }}
        >
          <TabFavicon tab={tab} />
          <strong className={cn(styles.paneText, styles.paneMenuTitle)}>{tab.title}</strong>
          <Button
            variant="ghost"
            size="sm"
            className={cn(styles.titlebarButton, styles.paneMenuClose)}
            disabled={!canClose(tab)}
            aria-label={t("browser.closeTab", { title: tab.title })}
            onClick={(event) => {
              event.stopPropagation();
              workbenchService.closeTab(tab.id);
            }}
          >
            <X size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}
