import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import { ButtonGroup } from "@ovule/ui/controls";
import { FolderOpen, Save, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PaneInstance } from "@ovule/panes/tab";
import { cn } from "@ovule/ui/cn";
import styles from "./PaneToolbar.module.css";

type ActionDefinition = {
  label: string;
  icon: typeof FolderOpen;
  command: string;
  requiresTarget?: boolean;
};
const chooseOffice: ActionDefinition = {
  label: "office.choose",
  icon: FolderOpen,
  command: "choose",
};
const saveOffice: ActionDefinition = { label: "office.save", icon: Save, command: "save" };
const paneActions: Partial<Record<PaneInstance["kind"], readonly ActionDefinition[]>> = {
  files: [chooseOffice, { ...saveOffice, requiresTarget: true }],
  office: [chooseOffice, saveOffice],
  markdown: [
    { label: "markdown.choose", icon: FolderOpen, command: "choose" },
    { label: "markdown.save", icon: Save, command: "save" },
  ],
  terminal: [
    { label: "terminal.find", icon: Search, command: "search" },
    { label: "terminal.clear", icon: Trash2, command: "clear" },
  ],
};

export function PaneToolbarActions({
  tab,
  command,
  startSearch,
}: {
  tab: PaneInstance;
  command(action: string): void;
  startSearch(): void;
}) {
  const { t } = useTranslation();
  return (
    <ButtonGroup
      className={cn("pane-toolbar-actions", styles.paneToolbarActions)}
      data-kind={tab.kind}
    >
      {(paneActions[tab.kind] ?? [])
        .filter((action) => !action.requiresTarget || tab.target)
        .map(({ label, icon: Icon, command: action }) => (
          <FeedbackButton
            key={action}
            label={t(label)}
            variant="ghost"
            size="sm"
            className={cn(styles.titlebarButton, styles.paneActiveTabAction)}
            action={action === "search" ? startSearch : () => command(action)}
          >
            <Icon className={styles.titlebarIcon} />
          </FeedbackButton>
        ))}
    </ButtonGroup>
  );
}
