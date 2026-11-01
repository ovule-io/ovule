import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import shellTokens from "@ovule/shell/shell.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";

import { Copy, LoaderCircle, PackagePlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { useService } from "@ovule/ioc/react";

import styles from "@ovule/ui/SettingsSection.module.css";
import { useExtensionCatalog } from "./useExtensionCatalog";
import { CatalogSection, CardList, CatalogCard } from "@ovule/ui/SettingsSection";
import type { SettingsSectionProps as Props } from "@ovule/settings/settings/settings";
type ExtensionsSectionDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
};

function ExtensionsSectionContent({
  dependencies,
  props,
}: {
  dependencies: ExtensionsSectionDependencies;
  props: Props;
}) {
  const i18n = useTranslation().i18n;

  const { shell } = dependencies;
  const { invoke } = props;

  const { t } = useTranslation();
  const { catalog, error, refresh: onRefresh } = useExtensionCatalog();
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string>();
  const install = async () => {
    const directory = await (
      await shell.dialog()
    ).openDirectory({
      title: t("catalog.installExtension"),
    });
    if (!directory) return;
    setInstalling(true);
    setInstallError(undefined);
    try {
      const installed = await invoke((api) => api.installExtension(directory));
      if (installed) await onRefresh();
    } catch (cause) {
      setInstallError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  };
  const setEnabled = async (extensionId: string, enabled: boolean) => {
    setInstallError(undefined);
    const changed = await invoke((api) => api.setExtensionEnabled(extensionId, enabled));
    if (changed) await onRefresh();
  };
  const remove = async (extensionId: string) => {
    if (!window.confirm(t("catalog.removeExtensionConfirm", { id: extensionId }))) return;
    setInstallError(undefined);
    const changed = await invoke((api) => api.removeExtension(extensionId));
    if (changed) await onRefresh();
  };
  return (
    <CatalogSection title={t("catalog.extensionCatalog")} note={t("catalog.extensionNote")}>
      <div className={styles.catalogActions}>
        <Button size="sm" disabled={installing} onClick={() => void install()}>
          {installing ? (
            <LoaderCircle className={styles.spin} size={12} />
          ) : (
            <PackagePlus size={12} />
          )}
          {t("catalog.installExtension")}
        </Button>
      </div>
      {error && <div className={styles.catalogError}>{error}</div>}
      {installError && <div className={styles.catalogError}>{installError}</div>}
      <CardList>
        {catalog?.extensions.map((extension) => (
          <CatalogCard
            key={`extension:${extension.id}`}
            title={extension.id}
            meta={`${extension.source} · ${extension.version}`}
            healthy={extension.enabled}
            enabled={extension.enabled}
            detail={
              extension.enabled ? t("catalog.extensionEnabled") : t("catalog.extensionDisabled")
            }
            onToggle={
              extension.source === "built-in"
                ? undefined
                : () => void setEnabled(extension.id, !extension.enabled)
            }
            onDelete={extension.removable ? () => void remove(extension.id) : undefined}
          >
            {extension.installPath && (
              <div className="min-w-0" data-extension-install-path={extension.id}>
                <span className="text-xs text-(--muted-foreground)">
                  {t("catalog.installPath")}
                </span>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 select-all break-all text-xs">
                    {extension.installPath}
                  </code>
                  <FeedbackButton
                    size="icon"
                    variant="ghost"
                    label={t("catalog.copyInstallPath")}
                    action={() => shell.copyText(extension.installPath)}
                  >
                    <Copy size={14} />
                  </FeedbackButton>
                </div>
              </div>
            )}
          </CatalogCard>
        ))}
        {catalog?.agents.map((agent) => (
          <CatalogCard
            key={`${agent.extensionId}:agent:${agent.id}`}
            title={agent.label}
            meta={`${agent.extensionId} · AgentDriver ${agent.id}`}
            healthy
            detail={`${agent.executableCandidates.join(" / ")}${
              agent.requiredEnvironment.length
                ? ` · env: ${agent.requiredEnvironment.join(", ")}`
                : ""
            }${agent.mcpConfig ? i18n.t("extensions.mCPConfig") : ""}`}
          />
        ))}
        {catalog?.models.map((model) => (
          <CatalogCard
            key={`${model.extensionId}:model:${model.id}`}
            title={model.label}
            meta={`${model.extensionId} · Model ${model.id}`}
            healthy
            detail={`${model.provider}/${model.remoteId} · ${model.agentIds.join(", ")}${
              model.description ? ` · ${model.description}` : ""
            }`}
          />
        ))}
        {catalog?.capabilities.map((capability) => (
          <CatalogCard
            key={`${capability.extensionId}:${capability.id}`}
            title={capability.label}
            meta={`${capability.extensionId} · ${capability.id}`}
            healthy
            detail={capability.description}
          />
        ))}
        {catalog?.messageBlocks.map((block) => (
          <CatalogCard
            key={`${block.extensionId}:${block.kind}`}
            title={block.kind}
            meta={`${block.extensionId} · ${block.uiType ?? block.hostRenderer ?? "isolated"}`}
            healthy
            detail={[block.tag, block.moduleUrl, block.capability].filter(Boolean).join(" · ")}
          />
        ))}
        {catalog?.slashCommands.map((command) => (
          <CatalogCard
            key={`${command.extensionId}:slash:${command.id}`}
            title={`/${command.id} · ${command.label}`}
            meta={`${command.extensionId} · Slash command`}
            healthy
            detail={command.description}
          />
        ))}
        {catalog?.computerUse.map((provider) => (
          <CatalogCard
            key={`${provider.extensionId}:computer-use:${provider.id}`}
            title={provider.label}
            meta={`${provider.extensionId} · Computer Use · ${provider.provider}`}
            healthy
            detail={`${provider.toolchainId} · ${provider.capabilities.join(" · ")}`}
          />
        ))}
        {catalog?.fileEditors.map((editor) => (
          <CatalogCard
            key={`${editor.extensionId}:file-editor:${editor.id}`}
            title={editor.label}
            meta={`${editor.extensionId} · File Editor · ${editor.mode}`}
            healthy
            detail={`${editor.extensions.map((extension) => `.${extension}`).join(", ")} · ${editor.moduleUrl}`}
          />
        ))}
      </CardList>
    </CatalogSection>
  );
}

export const ExtensionsSectionFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const dependencies = { shell };
  return function ExtensionsSection(props: Props) {
    return createElement(ExtensionsSectionContent, { dependencies, props });
  };
}, "ExtensionsSection");

export const ExtensionsSection = (
  ...args: Parameters<ServiceOf<typeof ExtensionsSectionFactory>>
) => useService(ExtensionsSectionFactory)(...args);
