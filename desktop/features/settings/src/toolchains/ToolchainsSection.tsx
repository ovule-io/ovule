import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import type { ToolchainView } from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";
import { cn } from "@ovule/ui/cn";
import styles from "@ovule/ui/SettingsSection.module.css";
import { CatalogSection, CardList } from "@ovule/ui/SettingsSection";
type ToolchainsSectionDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function ToolchainsSectionContent({
  dependencies,
}: {
  dependencies: ToolchainsSectionDependencies;
}) {
  const { workspace } = dependencies;

  const { t } = useTranslation();
  const [items, setItems] = useState<ToolchainView[]>([]);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmItem, setConfirmItem] = useState<ToolchainView>();
  const refresh = async () => {
    setBusyId("refresh");
    setError(undefined);
    setNotice(undefined);
    try {
      setItems(await (await workspace.api()).toolchainStatus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(undefined);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(
    () =>
      workspace.observeToolchainChanged((event) => {
        if (event.status === "failed") {
          setError(event.error ?? t("catalog.installToolchainFailed"));
          setNotice(undefined);
          setBusyId(undefined);
        } else if (event.status === "succeeded") {
          setNotice(t("catalog.installToolchainSucceeded", { label: event.id }));
          setBusyId(undefined);
        }
        void workspace
          .api()
          .then((api) => api.toolchainStatus())
          .then(setItems);
      }),
    [t, workspace],
  );
  useEffect(() => {
    if (!busyId || busyId === "refresh") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await (await workspace.api()).toolchainStatus();
        if (cancelled) return;
        setItems(next);
        const installed = next.find((item) => item.id === busyId);
        if (installed?.available || installed?.installStatus === "succeeded") {
          setNotice(t("catalog.installToolchainSucceeded", { label: installed.label }));
          setBusyId(undefined);
        } else if (installed?.installStatus === "failed") {
          setError(installed.installError ?? t("catalog.installToolchainFailed"));
          setNotice(undefined);
          setBusyId(undefined);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setBusyId(undefined);
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 750);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busyId, t, workspace]);
  const install = async (item: ToolchainView) => {
    setConfirmItem(undefined);
    setBusyId(item.id);
    setError(undefined);
    setNotice(t("catalog.installToolchainStarting", { label: item.label }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    try {
      const next = await (await workspace.api()).installToolchain(item.id);
      setItems(next);
      const installed = next.find((candidate) => candidate.id === item.id);
      if (installed?.available || installed?.installStatus === "succeeded") {
        setNotice(t("catalog.installToolchainSucceeded", { label: item.label }));
        setBusyId(undefined);
      } else if (installed?.installStatus === "failed") {
        setError(installed.installError ?? t("catalog.installToolchainFailed"));
        setNotice(undefined);
        setBusyId(undefined);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotice(undefined);
      setBusyId(undefined);
    }
  };
  return (
    <CatalogSection title={t("catalog.localToolchains")} note={t("catalog.toolchainNote")}>
      <div className={styles.catalogToolbar}>
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(busyId)}
          onClick={() => void refresh()}
        >
          <RefreshCw className={busyId === "refresh" ? styles.spin : undefined} size={14} />
          {t("catalog.refreshToolchains")}
        </Button>
      </div>
      {notice && (
        <div className={styles.catalogNotice} role="status">
          {busyId && <LoaderCircle className="animate-spin" size={14} />}
          {notice}
        </div>
      )}
      {error && (
        <div className={styles.catalogError} role="alert">
          {error}
        </div>
      )}
      <CardList>
        {items.map((item) => (
          <article className={cn("catalog-card", styles.catalogCard)} key={item.id}>
            <div className={styles.catalogCardTitle}>
              <span className={cn(styles.health, item.available && styles.ok)} />
              <strong>{item.label}</strong>
            </div>
            <code className={styles.catalogCardMeta}>
              {item.provider}
              {item.requestedVersion ? `@${item.requestedVersion}` : ""} ·{" "}
              {item.managed ? t("catalog.managed") : t("catalog.external")}
            </code>
            <p className={styles.catalogCardDetail}>{item.detail}</p>
            {(item.executable ?? item.installHint) && (
              <small className={styles.catalogCardFootnote}>
                {item.executable ?? item.installHint}
              </small>
            )}
            {item.requiredToolchainIds.length > 0 && (
              <small className={styles.catalogCardFootnote}>
                {t("catalog.requiresToolchains", {
                  tools: item.requiredToolchainIds.join(", "),
                })}
              </small>
            )}
            <div className={styles.catalogCardActions}>
              {!item.available && item.installable && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busyId)}
                  onClick={() => setConfirmItem(item)}
                >
                  {busyId === item.id && <LoaderCircle className="animate-spin" size={14} />}
                  {busyId === item.id
                    ? t("catalog.installingToolchain", { label: item.label })
                    : t("catalog.installToolchain")}
                </Button>
              )}
            </div>
          </article>
        ))}
      </CardList>
      {confirmItem && (
        <section
          className="rounded-lg border border-(--border) p-4"
          aria-label={t("catalog.installToolchainTitle")}
        >
          <header>
            <h3>{t("catalog.installToolchainTitle")}</h3>
            <p>
              {t("catalog.installToolchainConfirm", {
                label: confirmItem?.label,
              })}
            </p>
          </header>
          {confirmItem && (
            <div>
              <strong>
                {confirmItem.provider}
                {confirmItem.requestedVersion ? `@${confirmItem.requestedVersion}` : ""}
              </strong>
              <p>{t("catalog.installToolchainIsolation")}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmItem(undefined)}>
              {t("catalog.cancel")}
            </Button>
            <Button onClick={() => confirmItem && void install(confirmItem)}>
              {t("catalog.installToolchain")}
            </Button>
          </div>
        </section>
      )}
    </CatalogSection>
  );
}

export const ToolchainsSectionFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function ToolchainsSection() {
    return createElement(ToolchainsSectionContent, { dependencies });
  };
}, "ToolchainsSection");

export const ToolchainsSection = (
  ...args: Parameters<ServiceOf<typeof ToolchainsSectionFactory>>
) => useService(ToolchainsSectionFactory)(...args);
