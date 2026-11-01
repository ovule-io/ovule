import shellTokens from "@ovule/shell/shell.token";
import { useService } from "@ovule/ioc/react";
import type { DirectoryLoader } from "./FileBreadcrumbs";
import type { WorkspaceToolbarContext } from "@ovule/panes/pane";
import { Button } from "@ovule/ui/button";
import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import { ArrowLeft, ArrowRight, Link, RotateCw, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./BrowserWorkspaceToolbar.module.css";

export function browserAddressHost(address: string): string {
  try {
    const url = new URL(address);
    return url.host || address;
  } catch {
    return address;
  }
}

export function BrowserWorkspaceToolbar(props: WorkspaceToolbarContext) {
  const { listLocalDirectory } = useService(shellTokens.shell);
  return <BrowserWorkspaceToolbarContent {...props} loadDirectory={listLocalDirectory} />;
}

export function BrowserWorkspaceToolbarContent({
  tab,
  command,
  startEditing,
  copyAddress,
  editing,
  addressEditor,
  downloads,
  loadDirectory,
}: WorkspaceToolbarContext & { loadDirectory?: DirectoryLoader }) {
  const { t } = useTranslation();
  const address = tab.url ?? tab.target ?? "";
  return (
    <div className={styles.toolbar} data-browser-workspace-toolbar>
      <div className={styles.address} data-editing={editing}>
        <div className={styles.addressContent}>
          {editing ? (
            addressEditor
          ) : (
            <>
              <FeedbackButton
                className={styles.action}
                size="sm"
                label={t("browser.copyUrl")}
                successLabel={t("common.copied")}
                disabled={!address}
                action={copyAddress}
              >
                <Link />
              </FeedbackButton>
              {address.startsWith("file://") ? (
                <>
                  <FileBreadcrumbs
                    address={address}
                    loadDirectory={loadDirectory}
                    onNavigate={(url) => command(`browser.navigate:${url}`)}
                  />
                  <Button
                    className={styles.action}
                    size="sm"
                    aria-label={t("explorerTitlebar.editAddress")}
                    onClick={startEditing}
                  >
                    <Pencil />
                  </Button>
                </>
              ) : (
                <Button
                  className={styles.host}
                  size="sm"
                  aria-label={t("explorerTitlebar.editAddress")}
                  title={address}
                  onClick={startEditing}
                >
                  {browserAddressHost(address) || tab.title}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <Button
        className={styles.action}
        size="sm"
        aria-label={t("browser.back")}
        disabled={!tab.canGoBack}
        onClick={() => command("browser.back")}
      >
        <ArrowLeft />
      </Button>
      <Button
        className={styles.action}
        size="sm"
        aria-label={t("browser.forward")}
        disabled={!tab.canGoForward}
        onClick={() => command("browser.forward")}
      >
        <ArrowRight />
      </Button>
      <Button
        className={styles.action}
        size="sm"
        aria-label={t("browser.reload")}
        onClick={() => command("browser.reload")}
      >
        <RotateCw />
      </Button>
      {downloads}
    </div>
  );
}
