import type { PaneToolbarContext } from "@ovule/panes/pane";
import { Button } from "@ovule/ui/button";
import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import { Tooltip } from "@ovule/ui/tooltip";
import {
  CircleCheck,
  CircleX,
  ClipboardPaste,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { decodeLinkRemoteControlSession } from "./session-links-codec";
import { connectionErrorKey } from "./connection-error";
import styles from "./SpicePaneToolbar.module.css";

export function SpicePaneToolbar({ tab, command }: PaneToolbarContext) {
  const { t } = useTranslation();
  const link = Boolean(decodeLinkRemoteControlSession(tab.target));
  const state = tab.toolbarState;
  const status = state?.status ?? "connecting";
  const connected = status === "connected";
  const label = `${t(`spice.status.${status}`)}${state?.error ? ` · ${link ? t(connectionErrorKey(state.error)) : state.error}` : ""}`;
  const Status = connected
    ? CircleCheck
    : ["error", "disconnected"].includes(status)
      ? CircleX
      : LoaderCircle;
  return (
    <div className={styles.toolbar} data-spice-pane-toolbar>
      <span className={styles.title} title={tab.title}>
        {tab.title}
      </span>
      <div className={styles.controls} data-remote-control-toolbar>
        <Tooltip side="bottom" content={label}>
          <span className={styles.status} role="status" aria-label={label} data-status={status}>
            <Status
              className={
                !connected && status !== "error" && status !== "disconnected" ? "spin" : undefined
              }
            />
          </span>
        </Tooltip>
        {link && (
          <>
            <Select
              value={state?.mode ?? "all"}
              onValueChange={(value) => command(`remote.mode:${value}`)}
            >
              <SelectTrigger className={styles.select} aria-label={t("spice.connectionMode")}>
                <SelectValue>
                  {t(state?.mode === "relay" ? "spice.connectionRelay" : "spice.connectionAuto")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("spice.connectionAuto")}</SelectItem>
                <SelectItem value="relay">{t("spice.connectionRelay")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={state?.quality ?? "balanced"}
              onValueChange={(value) => command(`remote.quality:${value}`)}
            >
              <SelectTrigger className={styles.select} aria-label={t("spice.quality")}>
                <SelectValue>
                  {t(qualityLabels[state?.quality ?? "balanced"] ?? qualityLabels.balanced!)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(qualityLabels).map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {t(text)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <FeedbackButton
          className={styles.action}
          variant="ghost"
          size="sm"
          label={t(link ? "spice.pushClipboard" : "spice.syncClipboard")}
          disabled={!connected}
          action={async () => {
            command(
              link
                ? `remote.clipboard:${await navigator.clipboard.readText()}`
                : "remote.syncClipboard",
            );
            return true;
          }}
        >
          <ClipboardPaste />
        </FeedbackButton>
        <Tooltip side="bottom" content={t("spice.ctrlAltDel")}>
          <Button
            className={styles.action}
            variant="ghost"
            size="sm"
            aria-label={t("spice.ctrlAltDel")}
            disabled={!connected}
            onClick={() => command("remote.ctrlAltDelete")}
          >
            <ShieldAlert />
          </Button>
        </Tooltip>
        <Tooltip side="bottom" content={t("spice.reconnect")}>
          <Button
            className={styles.action}
            variant="ghost"
            size="sm"
            aria-label={t("spice.reconnect")}
            onClick={() => command("remote.reconnect")}
          >
            <RefreshCw />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
const qualityLabels: Record<string, string> = {
  balanced: "spice.qualityBalanced",
  detail: "spice.qualityDetail",
  efficient: "spice.qualityEfficient",
  responsive: "spice.qualityResponsive",
};
