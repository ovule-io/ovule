import { useTranslation } from "react-i18next";
import { Avatar } from "@ovule/ui/data-display";
import { Button } from "@ovule/ui/button";
import { AvatarGroup, AvatarGroupCount } from "@ovule/ui/controls";
import { Tooltip } from "@ovule/ui/tooltip";
import { useState } from "react";

import type { PaneInstance } from "@ovule/panes/tab";
import { TabFavicon } from "./TabFavicon";
import { cn } from "@ovule/ui/cn";
import { recentTabs, TAB_INDICATOR_LIMIT } from "./recent-tabs";
import styles from "./PaneToolbar.module.css";

export function PaneTabIndicators({
  tabs,
  onSelect,
}: {
  tabs: PaneInstance[];
  onSelect(tabId: string): void;
}) {
  const i18n = useTranslation().i18n;

  useTranslation();
  const [open, setOpen] = useState(false);
  const ordered = recentTabs(tabs);

  return (
    <div className={styles.workspaceTabIndicators}>
      <AvatarGroup className={styles.paneTabIcons}>
        {ordered.slice(0, TAB_INDICATOR_LIMIT).map((tab) => (
          <Tooltip key={tab.id} side="bottom" content={tab.title}>
            <Avatar className={styles.paneTabAvatar}>
              <Button
                size="sm"
                className={cn(styles.titlebarButton, styles.paneTabButton)}
                data-tab-id={tab.id}
                aria-label={tab.title}
                onClick={() => onSelect(tab.id)}
              >
                <TabFavicon tab={tab} className={styles.paneAvatarFavicon} />
              </Button>
            </Avatar>
          </Tooltip>
        ))}
        {tabs.length > TAB_INDICATOR_LIMIT && (
          <Tooltip side="bottom" content={i18n.t("explorerTitlebar.showAllTabs")}>
            <Avatar className={cn(styles.paneTabAvatar, styles.paneCountAvatar)}>
              <Button
                size="sm"
                className={cn(styles.titlebarButton, styles.paneTabButton)}
                aria-label={i18n.t("explorerTitlebar.showAllTabs")}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                <AvatarGroupCount className={styles.paneCount}>
                  +{tabs.length - TAB_INDICATOR_LIMIT}
                </AvatarGroupCount>
              </Button>
            </Avatar>
          </Tooltip>
        )}
      </AvatarGroup>
      {open && (
        <div
          className={cn(styles.paneDropdown, styles.paneIndicatorDropdown)}
          role="menu"
          aria-label={i18n.t("explorerTitlebar.allTabs")}
        >
          {ordered.map((tab) => (
            <Button
              size="sm"
              role="menuitem"
              className={cn(styles.titlebarButton, styles.paneIndicatorDropdownButton)}
              key={tab.id}
              onClick={() => {
                onSelect(tab.id);
                setOpen(false);
              }}
            >
              <TabFavicon tab={tab} />
              <strong className={cn(styles.paneText, styles.paneTitle)}>{tab.title}</strong>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
