import { useEffect, useState, useSyncExternalStore } from "react";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import shellTokens from "@ovule/shell/shell.token";
import { Button } from "@ovule/ui/button";
import { Input } from "@ovule/ui/form";
import type { DownloadsState } from "@ovule/shell/downloads";
import styles from "./GeneralSettings.module.css";
const empty: DownloadsState = { items: [], directory: "~/Downloads" };
const subscribe = () => () => {};
export function DownloadSettings() {
  const shell = useService(shellTokens.shell);
  const { downloads } = shell;
  const state = useSyncExternalStore(
    downloads?.subscribe ?? subscribe,
    downloads?.current ?? (() => empty),
    () => empty,
  );
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void downloads?.refresh().catch((cause) => setError(String(cause)));
  }, [downloads]);
  if (!downloads) return null;
  const choose = async (reset: boolean) => {
    setBusy(true);
    setError("");
    try {
      const path = reset
        ? ""
        : await (await shell.dialog()).openDirectory({ title: t("settings.downloadDirectory") });
      if (path !== undefined) await downloads.setDirectory(path);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={styles.section}
      data-general-section="downloads"
      aria-labelledby="settings-downloads-label"
    >
      <div className={styles.row}>
        <h4 className={styles.title} id="settings-downloads-label">
          {t("settings.downloadDirectory")}
        </h4>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input
            readOnly
            value={state.directory}
            title={state.directory}
            aria-labelledby="settings-downloads-label"
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void choose(false)}
          >
            <FolderOpen size={14} />
            {t("settings.chooseDownloadDirectory")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void choose(true)}
          >
            {t("settings.resetDownloadDirectory")}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-(--muted-foreground)">
        {t("settings.downloadDirectoryHelp")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-(--danger)">
          {error}
        </p>
      )}
    </section>
  );
}
