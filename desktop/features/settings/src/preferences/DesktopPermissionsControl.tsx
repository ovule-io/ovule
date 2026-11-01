import styles from "./GeneralSettings.module.css";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import type { DesktopPermissions } from "@ovule/shell-api";
import { Button } from "@ovule/ui/button";

/** Local grants only: pairing and keeping awake never authorize OS capture. */
export function DesktopPermissionsControl() {
  const workspace = useService(workspaceTokens.workspace);
  const { t } = useTranslation();
  const [status, setStatus] = useState<DesktopPermissions>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const version = useRef(0);
  const requesting = useRef(false);

  useEffect(() => {
    const load = async () => {
      if (requesting.current) return;
      const request = ++version.current;
      try {
        const value = await workspace.api().then((api) => api.desktopPermissions());
        if (request === version.current) {
          setStatus(value);
          setError(undefined);
        }
      } catch (cause) {
        if (request === version.current) setError(String(cause));
      }
    };
    void load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      ++version.current;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [workspace, refresh]);

  const authorize = async (permission: "screenRecording" | "accessibility") => {
    if (requesting.current) return;
    requesting.current = true;
    const request = ++version.current;
    setBusy(true);
    setError(undefined);
    try {
      const value = await workspace.api().then((api) => api.requestDesktopPermission(permission));
      if (request === version.current) setStatus(value);
    } catch (cause) {
      if (request === version.current) setError(String(cause));
    } finally {
      requesting.current = false;
      if (request === version.current) setBusy(false);
    }
  };

  const matches = status?.bundleId === status?.expectedBundleId;
  return (
    <section
      className={styles.section}
      aria-label={t("desktopPermissions.title")}
      data-general-section="permissions"
      data-desktop-permissions
    >
      <header className={styles.header}>
        <h4 className={styles.title}>{t("desktopPermissions.title")}</h4>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {t("desktopPermissions.refresh")}
        </Button>
      </header>
      <div className={styles.group}>
        <h5 className={styles.groupTitle}>{t("desktopPermissions.desktopGroup")}</h5>
        <p className={styles.note}>{t("desktopPermissions.description")}</p>
      </div>
      {!status ? (
        !error && <p role="status">{t("desktopPermissions.loading")}</p>
      ) : !status.managed ? (
        <p>{t("desktopPermissions.unmanaged")}</p>
      ) : (
        <>
          {!matches && (
            <p role="alert">
              {t("desktopPermissions.mismatch", { bundleId: status.expectedBundleId })}
            </p>
          )}
          {(["screenRecording", "accessibility"] as const).map((permission) => (
            <div key={permission} className={styles.permissionRow}>
              <div className={styles.permissionLabel}>
                <span>{t(`desktopPermissions.${permission}`)}</span>
                <span role="status" className={styles.note}>
                  {t(
                    status[permission]
                      ? "desktopPermissions.granted"
                      : "desktopPermissions.required",
                  )}
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !matches}
                onClick={() => void authorize(permission)}
              >
                {t(
                  status[permission] ? "desktopPermissions.manage" : "desktopPermissions.authorize",
                )}
              </Button>
            </div>
          ))}
          <footer className={styles.footer}>
            <p className={styles.note}>
              {t("desktopPermissions.identity", {
                bundleId: status.bundleId ?? t("desktopPermissions.unbundled"),
              })}
            </p>
            <p className={styles.note}>{t("desktopPermissions.restart")}</p>
          </footer>
        </>
      )}
      {error && (
        <p role="alert" className="break-words text-(--danger)">
          {error}
        </p>
      )}
    </section>
  );
}
