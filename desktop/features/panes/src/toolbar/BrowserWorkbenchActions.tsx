import { useTranslation } from "react-i18next";
import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import { ArrowLeft, ArrowRight, Link, Pencil, RotateCw } from "lucide-react";
import { cn } from "@ovule/ui/cn";
import { TitlebarAction } from "./ToolbarControls";
import type { ToolbarModel } from "./useToolbarModel";
import styles from "./PaneToolbar.module.css";

export function BrowserWorkbenchActions({ model }: { model: ToolbarModel }) {
  const { t, i18n } = useTranslation();
  const { active, copyAddress, startEditing, paneCommand } = model;
  if (!active) return null;
  return (
    <>
      <FeedbackButton
        label={t("browser.copyUrl")}
        successLabel={t("common.copied")}
        size="sm"
        className={cn(styles.titlebarButton, styles.paneActiveTabAction)}
        disabled={!active.url && !active.target}
        action={copyAddress}
      >
        <Link className={styles.titlebarIcon} />
      </FeedbackButton>
      <TitlebarAction label={i18n.t("explorerTitlebar.editAddress")} onClick={startEditing}>
        <Pencil />
      </TitlebarAction>
      <FeedbackButton
        size="sm"
        className={cn(styles.titlebarButton, styles.paneActiveTabAction)}
        label={t("browser.reload")}
        action={() => paneCommand("browser.reload")}
      >
        <RotateCw />
      </FeedbackButton>
      {active.canGoBack && (
        <FeedbackButton
          size="sm"
          className={cn(styles.titlebarButton, styles.paneActiveTabAction)}
          label={t("browser.back")}
          action={() => paneCommand("browser.back")}
        >
          <ArrowLeft />
        </FeedbackButton>
      )}
      {active.canGoForward && (
        <FeedbackButton
          size="sm"
          className={cn(styles.titlebarButton, styles.paneActiveTabAction)}
          label={t("browser.forward")}
          action={() => paneCommand("browser.forward")}
        >
          <ArrowRight />
        </FeedbackButton>
      )}
    </>
  );
}
