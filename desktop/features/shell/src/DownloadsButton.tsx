import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, FileDown, FolderOpen, Pause, Play, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import { Button } from "@ovule/ui/button";
import {
  Attachment,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
} from "@ovule/ui/attachment";
import { Tooltip } from "@ovule/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@ovule/ui/overlays";
import shellTokens from "./shell.token";
import type { DownloadsState } from "./downloads";
import styles from "./DownloadsButton.module.css";

const empty: DownloadsState = { items: [], directory: "~/Downloads" };
const noopSubscribe = () => () => {};
export function DownloadsButton({
  className,
  side = "bottom",
}: {
  className?: string;
  side?: "left" | "right" | "bottom";
}) {
  const { downloads } = useService(shellTokens.shell);
  const state = useSyncExternalStore(
    downloads?.subscribe ?? noopSubscribe,
    downloads?.current ?? (() => empty),
    () => empty,
  );
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const skipRestoreFocus = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    void downloads?.refresh().catch(() => {});
  }, [downloads]);
  useEffect(() => {
    if (!open) return;
    if (!downloads || !state.items.length) {
      setOpen(false);
      return;
    }
    const dismiss = () => {
      skipRestoreFocus.current = true;
      setOpen(false);
    };
    const pointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (
        (trigger.current && path.includes(trigger.current)) ||
        (panel.current && path.includes(panel.current))
      )
        return;
      dismiss();
    };
    // Native Explorer / iframe clicks belong to another document. Its focus
    // handoff blurs this window even though no pointer event bubbles here.
    document.addEventListener("pointerdown", pointerDown, true);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      window.removeEventListener("blur", dismiss);
    };
  }, [open, downloads, state.items.length]);
  if (!downloads || !state.items.length) return null;
  const active = state.items.filter((item) => item.state === "in-progress");
  const total = active.reduce((sum, item) => sum + item.totalBytes, 0);
  const fraction =
    active.length && active.every((item) => item.totalBytes > 0)
      ? Math.min(1, active.reduce((sum, item) => sum + item.receivedBytes, 0) / total)
      : undefined;
  const percent = fraction === undefined ? undefined : Math.round(fraction * 100);
  const label = `${t("browser.downloads")}${active.length ? ` · ${percent === undefined ? t("browser.downloading") : `${percent}%`}` : ""}`;
  const act = async (key: string, action: "reveal" | "remove" | "cancel" | "pause" | "resume") => {
    setBusy(key);
    setError("");
    try {
      await downloads[action](key);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(open) => {
        setOpen(open);
        if (open) skipRestoreFocus.current = false;
        if (open) void downloads.refresh().catch((cause) => setError(String(cause)));
      }}
    >
      <Tooltip content={label} side={side}>
        <PopoverTrigger asChild ref={trigger}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={className}
            aria-label={label}
            data-download-history
          >
            {active.length ? (
              <svg viewBox="0 0 32 32" className={styles.ring} aria-hidden="true">
                <circle cx="16" cy="16" r="13" className={styles.track} />
                <circle
                  cx="16"
                  cy="16"
                  r="13"
                  className={percent === undefined ? styles.indeterminate : styles.value}
                  strokeDasharray={`${(fraction ?? 0.25) * 81.68} 81.68`}
                />
                {percent === undefined ? (
                  <path
                    d="M16 10v10m-4-4 4 4 4-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                ) : (
                  <text x="16" y="19" textAnchor="middle" className={styles.percent}>
                    {percent}%
                  </text>
                )}
              </svg>
            ) : (
              <Download size={16} />
            )}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        ref={panel}
        onCloseAutoFocus={(event) => {
          if (skipRestoreFocus.current) event.preventDefault();
        }}
        side={side}
        align={side === "bottom" ? "end" : "start"}
        sideOffset={side === "bottom" ? 6 : 12}
        collisionPadding={20}
        className={styles.panel}
      >
        <header className={styles.header}>
          <strong>{t("browser.downloads")}</strong>
          <span className={styles.count}>{state.items.length}</span>
        </header>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.list}>
          {[...state.items]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((item) => {
              const progress =
                item.totalBytes > 0 ? Math.min(1, item.receivedBytes / item.totalBytes) : undefined;
              const locale = i18n.resolvedLanguage ?? i18n.language;
              const size = (bytes: number) => {
                const value = Math.max(0, bytes);
                const unit = Math.min(4, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)));
                return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1024 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
              };
              const downloadedAt = new Date(item.createdAt);
              return (
                <Attachment
                  key={item.key}
                  orientation="horizontal"
                  state={
                    item.saveError || item.state === "interrupted"
                      ? "error"
                      : item.state === "in-progress"
                        ? "processing"
                        : "done"
                  }
                  className={styles.row}
                  data-download-record
                >
                  <AttachmentMedia>
                    <FileDown aria-hidden="true" />
                  </AttachmentMedia>
                  <AttachmentContent className={styles.body}>
                    <AttachmentTitle title={item.filename}>
                      {item.filename || t("browser.download")}
                    </AttachmentTitle>
                    <AttachmentDescription className={styles.metadata}>
                      <small className={styles.status}>
                        {item.saveError
                          ? t("browser.downloadSaveFailed")
                          : item.paused
                            ? t("browser.downloadPaused")
                            : item.state === "complete" && !item.savedId
                              ? t("browser.savingDownload")
                              : item.state === "in-progress"
                                ? progress === undefined
                                  ? t("browser.downloading")
                                  : `${Math.round(progress * 100)}%`
                                : t(`browser.downloadState.${item.state}`)}
                      </small>
                      <small data-download-size>
                        {item.state === "in-progress" && item.totalBytes > 0
                          ? `${size(item.receivedBytes)} / ${size(item.totalBytes)}`
                          : size(item.totalBytes > 0 ? item.totalBytes : item.receivedBytes)}
                      </small>
                      <time
                        dateTime={downloadedAt.toISOString()}
                        title={downloadedAt.toLocaleString(locale)}
                      >
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(downloadedAt)}
                      </time>
                    </AttachmentDescription>
                    {item.state === "in-progress" && (
                      <progress max={1} value={progress} aria-label={item.filename} />
                    )}
                    {item.saveError && <small className={styles.error}>{item.saveError}</small>}
                  </AttachmentContent>
                  <AttachmentActions className={styles.actions}>
                    {((item.state === "in-progress" && !item.paused) || item.canResume) && (
                      <AttachmentAction
                        disabled={busy === item.key}
                        aria-label={t(
                          item.paused || item.state === "interrupted"
                            ? "browser.resumeDownload"
                            : "browser.pauseDownload",
                        )}
                        title={t(
                          item.paused || item.state === "interrupted"
                            ? "browser.resumeDownload"
                            : "browser.pauseDownload",
                        )}
                        onClick={() =>
                          void act(
                            item.key,
                            item.paused || item.state === "interrupted" ? "resume" : "pause",
                          )
                        }
                      >
                        {item.paused || item.state === "interrupted" ? (
                          <Play size={14} />
                        ) : (
                          <Pause size={14} />
                        )}
                      </AttachmentAction>
                    )}
                    {item.state === "in-progress" && (
                      <AttachmentAction
                        disabled={busy === item.key}
                        aria-label={t("browser.cancelDownload")}
                        title={t("browser.cancelDownload")}
                        onClick={() => void act(item.key, "cancel")}
                      >
                        <X size={14} />
                      </AttachmentAction>
                    )}
                    {item.savedId && (
                      <AttachmentAction
                        disabled={busy === item.key}
                        aria-label={t("browser.openDownloadFolder")}
                        title={t("browser.openDownloadFolder")}
                        onClick={() => void act(item.key, "reveal")}
                      >
                        <FolderOpen size={14} />
                      </AttachmentAction>
                    )}
                    {item.state !== "in-progress" && (
                      <AttachmentAction
                        disabled={busy === item.key}
                        aria-label={t("browser.deleteDownloadRecord")}
                        title={t("browser.deleteDownloadRecord")}
                        onClick={() => void act(item.key, "remove")}
                      >
                        <Trash2 size={14} />
                      </AttachmentAction>
                    )}
                  </AttachmentActions>
                </Attachment>
              );
            })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
