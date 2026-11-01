import { cloneElement, type ReactElement, type PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Tabs } from "@ovule/ui/tabs";
import { Tooltip } from "@ovule/ui/tooltip";
import { Plus, X } from "lucide-react";
import { cn } from "@ovule/ui/cn";
import type { ToolbarModel } from "./useToolbarModel";
import { NewTabActions } from "./NewTabActions";
import styles from "./PaneToolbar.module.css";

export function ToolbarRoot({ model, children }: PropsWithChildren<{ model: ToolbarModel }>) {
  return (
    <Tabs
      value={model.active?.id}
      onValueChange={model.selectTab}
      ref={model.root}
      className={cn("explorer-titlebar", styles.workspaceTitlebarRoot, model.className)}
      data-workspace-titlebar-root
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) model.dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") model.dismiss();
      }}
    >
      {children}
      {model.error && <span role="alert">{model.error}</span>}
      <NewTabActions model={model} />
    </Tabs>
  );
}
export function AddTabButton({ model }: { model: ToolbarModel }) {
  const { t } = useTranslation();
  return (
    <Tooltip side="bottom" content={t("explorerTitlebar.addTab")}>
      <Button
        size="sm"
        className={styles.titlebarButton}
        aria-label={t("explorerTitlebar.addTab")}
        onClick={model.addTab}
      >
        <Plus className={styles.titlebarIcon} />
      </Button>
    </Tooltip>
  );
}
export function CloseTabButton({ model }: { model: ToolbarModel }) {
  const { t } = useTranslation();
  if (!model.active) return null;
  return (
    <TitlebarAction
      label={t("browser.closeTab", { title: model.active.title })}
      closeAction
      disabled={!model.canClose(model.active)}
      onClick={model.closeActive}
    >
      <X />
    </TitlebarAction>
  );
}
export function TitlebarAction({
  closeAction = false,
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  closeAction?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactElement<{ className?: string }>;
}) {
  return (
    <Tooltip side="bottom" content={label}>
      <Button
        size="sm"
        className={cn(
          styles.titlebarButton,
          styles.paneActiveTabAction,
          closeAction && "pane-active-tab-close",
        )}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
      >
        {cloneElement(children, {
          className: cn(children.props.className, styles.titlebarIcon),
        })}
      </Button>
    </Tooltip>
  );
}
