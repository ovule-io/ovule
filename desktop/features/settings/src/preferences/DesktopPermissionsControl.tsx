import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@ovule/ui/dialog";
import { FolderSearch, RotateCw } from "lucide-react";
import styles from "./GeneralSettings.module.css";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import shellTokens from "@ovule/shell/shell.token";
import type { DesktopPermissions } from "@ovule/shell-api";
import { Button } from "@ovule/ui/button";

/** Local OS grants apply to the running build, independently of Host pairing. */
export function DesktopPermissionsControl({ showAbout = false }: { showAbout?: boolean }) {
  const workspace = useService(workspaceTokens.workspace);
  const shell = useService(shellTokens.shell);
  const { t, i18n } = useTranslation();
  const [repair, setRepair] = useState<"screenRecording" | "accessibility">();
  const [status, setStatus] = useState<DesktopPermissions>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date>();
  const [refresh, setRefresh] = useState(0);
  const version = useRef(0);
  const requesting = useRef(false);

  useEffect(() => {
    const load = async () => {
      if (requesting.current || document.visibilityState === "hidden") return;
      const request = ++version.current;
      setChecking(true);
      try {
        const value = await workspace.api().then((api) => api.desktopPermissions());
        if (request === version.current) {
          setStatus(value);
          setCheckedAt(new Date());
          setError(undefined);
        }
      } catch (cause) {
        if (request === version.current) setError(String(cause));
      } finally {
        if (request === version.current) setChecking(false);
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

  const authorize = async (permission: string) => {
    if (requesting.current) return;
    requesting.current = true;
    const request = ++version.current;
    setChecking(false);
    setBusy(true);
    setError(undefined);
    try {
      const value = await workspace.api().then((api) => api.requestDesktopPermission(permission));
      if (request === version.current) {
        setStatus(value);
        setCheckedAt(new Date());
      }
    } catch (cause) {
      if (request === version.current) setError(String(cause));
    } finally {
      requesting.current = false;
      if (request === version.current) setBusy(false);
    }
  };
  const revealApp = async () => {
    if (!status?.bundlePath || !shell.revealLocalFile) return;
    const url = new URL("file:///");
    url.pathname = status.bundlePath;
    try {
      await shell.revealLocalFile(url.href);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const matches = Boolean(status && status.bundleId === status.expectedBundleId);
  const pending = busy || checking;
  const adHoc = status?.signingIdentity?.includes("Signature=adhoc");
  return (
    <>
      <Dialog
        open={Boolean(repair)}
        onOpenChange={(open) => {
          if (!open) setRepair(undefined);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {t("desktopPermissions.repairTitle", {
              permission: repair ? t(`desktopPermissions.${repair}`) : "",
            })}
          </DialogTitle>
          <DialogDescription>{t("desktopPermissions.repairDescription")}</DialogDescription>
          <p className={styles.downloadPath}>{status?.bundlePath}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRepair(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const permission = repair;
                setRepair(undefined);
                if (permission)
                  void authorize(
                    permission === "screenRecording"
                      ? "resetScreenRecording"
                      : "resetAccessibility",
                  );
              }}
            >
              {t("desktopPermissions.repairConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <section
        className={styles.section}
        aria-label={t("desktopPermissions.title")}
        data-general-section="permissions"
        data-desktop-permissions
        aria-busy={pending}
      >
        <header className={styles.header}>
          <h4 className={styles.title}>{t("desktopPermissions.title")}</h4>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("desktopPermissions.refresh")}
            title={t("desktopPermissions.refresh")}
            disabled={pending}
            onClick={() => {
              setChecking(true);
              setRefresh((value) => value + 1);
            }}
          >
            <RotateCw size={14} className={checking ? styles.refreshing : undefined} />
          </Button>
        </header>
        <p className={styles.note} role="status" aria-live="polite" data-permissions-feedback>
          {checking
            ? t("desktopPermissions.loading")
            : checkedAt
              ? t("desktopPermissions.checked", {
                  time: new Intl.DateTimeFormat(i18n.language, { timeStyle: "medium" }).format(
                    checkedAt,
                  ),
                })
              : null}
        </p>
        {!status ? null : !status.managed ? (
          <p>{t("desktopPermissions.unmanaged")}</p>
        ) : (
          <>
            {!matches && (
              <p role="alert">
                {t("desktopPermissions.mismatch", { bundleId: status.expectedBundleId })}
              </p>
            )}
            {(["screenRecording", "accessibility", "inputMonitoring"] as const).map(
              (permission) => {
                const verified = permission === "screenRecording" && status.screenCaptureVerified;
                const granted = status[permission] || verified;
                return (
                  <div
                    key={permission}
                    className={styles.permissionRow}
                    data-permission={permission}
                  >
                    <div className={styles.permissionLabel}>
                      <span>{t(`desktopPermissions.${permission}`)}</span>
                      {permission === "inputMonitoring" && (
                        <span className={styles.note}>
                          {t("desktopPermissions.inputMonitoringHelp")}
                        </span>
                      )}
                      <span className={styles.note}>
                        {t(
                          verified
                            ? "desktopPermissions.captureVerified"
                            : granted
                              ? "desktopPermissions.granted"
                              : "desktopPermissions.notConfirmed",
                        )}
                      </span>
                    </div>
                    <div className={styles.permissionActions}>
                      {adHoc && !granted && permission !== "inputMonitoring" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending || !matches}
                          onClick={() => setRepair(permission)}
                        >
                          {t("desktopPermissions.repair")}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={pending || !matches}
                        onClick={() => void authorize(permission)}
                      >
                        {t(
                          granted
                            ? "desktopPermissions.openSettings"
                            : "desktopPermissions.requestAccess",
                        )}
                      </Button>
                    </div>
                  </div>
                );
              },
            )}
            {adHoc &&
              ((!status.screenRecording && !status.screenCaptureVerified) ||
                !status.accessibility) && (
                <div className={styles.recovery}>
                  <p className={styles.note}>{t("desktopPermissions.adHocRecovery")}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!shell.revealLocalFile || !status.bundlePath}
                    onClick={() => void revealApp()}
                  >
                    <FolderSearch size={14} />
                    {t("desktopPermissions.showApp")}
                  </Button>
                </div>
              )}
            <div className={styles.permissionRow} data-permission="automation">
              <div className={styles.permissionLabel}>
                <span>{t("desktopPermissions.automation")}</span>
                <span className={styles.note}>{t("desktopPermissions.automationUnavailable")}</span>
              </div>
            </div>
            {(["filesAndFolders", "fullDiskAccess"] as const).map((permission) => (
              <div key={permission} className={styles.permissionRow} data-permission={permission}>
                <div className={styles.permissionLabel}>
                  <span>{t(`desktopPermissions.${permission}`)}</span>
                  <span className={styles.note}>{t(`desktopPermissions.${permission}Help`)}</span>
                </div>
                <div className={styles.permissionActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pending || !matches}
                    onClick={() => void authorize(permission)}
                  >
                    {t("desktopPermissions.openSettings")}
                  </Button>
                  {permission === "fullDiskAccess" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!shell.revealLocalFile || !status.bundlePath}
                      onClick={() => void revealApp()}
                    >
                      {t("desktopPermissions.showApp")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <p className={styles.note}>{t("desktopPermissions.restart")}</p>
          </>
        )}
        {error && (
          <p role="alert" className="break-words text-(--danger)">
            {error}
          </p>
        )}
      </section>
      {showAbout && status && (
        <section
          className={styles.section}
          data-general-section="about"
          data-about-ovule
          aria-label={t("desktopPermissions.about", { version: status.appVersion })}
        >
          <h4 className={styles.title}>
            {t("desktopPermissions.about", { version: status.appVersion })}
          </h4>
          <dl className={styles.aboutDetails}>
            <dt>{t("desktopPermissions.bundleId")}</dt>
            <dd>{status.bundleId ?? t("desktopPermissions.unbundled")}</dd>
            {status.bundlePath && (
              <>
                <dt>{t("desktopPermissions.appLocation")}</dt>
                <dd>{status.bundlePath}</dd>
              </>
            )}
          </dl>
          {status.executablePath && (
            <details className={styles.aboutDisclosure}>
              <summary>{t("desktopPermissions.buildIdentity")}</summary>
              <pre className={styles.identityDetails}>
                {status.executablePath}
                {"\n"}
                {status.signingIdentity}
              </pre>
            </details>
          )}
          {Boolean(status.otherBundlePaths?.length) && (
            <details className={styles.aboutDisclosure}>
              <summary>{t("desktopPermissions.otherCopies")}</summary>
              {status.otherBundlePaths.map((path) => (
                <p key={path} className={styles.note}>
                  {path}
                </p>
              ))}
              <p className={styles.note}>{t("desktopPermissions.copiesNote")}</p>
            </details>
          )}
        </section>
      )}
    </>
  );
}
