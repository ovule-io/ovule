import { IsolatedSetup } from "../onboarding/IsolatedSetup";
import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import settingsTokens from "@ovule/settings/settings.token";
import type { ViewData } from "./view-data";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import type {
  ExtensionCatalogView,
  OnboardingModelOption,
  OnboardingStatus,
} from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";
import { cn } from "@ovule/ui/cn";
import styles from "@ovule/ui/SettingsSection.module.css";
import {
  CatalogSection,
  CatalogForm,
  Field,
  CheckList,
  FormActions,
  CardList,
  CatalogCard,
} from "@ovule/ui/SettingsSection";
import type { SettingsSectionProps as Props } from "@ovule/settings/settings/settings";
type ModelsSectionDependencies = {
  OllamaSetup: ServiceOf<typeof settingsTokens.ollamaSetupView>;
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function ModelsSectionContent({
  dependencies,
  props,
}: {
  dependencies: ModelsSectionDependencies;
  props: Props;
}) {
  const runtime = useService(shellTokens.snapshotSync);
  const useExtensionCatalog = useService(settingsTokens.extensionCatalogHook);

  const { OllamaSetup, workspace } = dependencies;
  const { snapshot, busy, invoke } = props;

  const { t } = useTranslation();
  const { catalog: extensions } = useExtensionCatalog();
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("");
  const [remoteId, setRemoteId] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>(["ovule"]);
  const drivers = agentDriverOptions(snapshot, extensions);
  const [providerSetups, setProviderSetups] = useState<OnboardingStatus["setups"]>([]);
  const [refreshingProvider, setRefreshingProvider] = useState<string>();
  const [providerError, setProviderError] = useState<string>();
  useEffect(() => {
    let active = true;
    void workspace
      .api()
      .then((api) => api.onboardingStatus())
      .then((status) => {
        if (active)
          setProviderSetups(
            status.setups.filter(
              (setup) =>
                setup.modelProvider &&
                setup.agentIds.length === 0 &&
                setup.extensionId !== "io.ovule.host",
            ),
          );
      })
      .catch((error) => {
        if (active) setProviderError(String(error));
      });
    return () => {
      active = false;
    };
  }, [workspace]);
  const refreshProvider = async (
    setup: OnboardingStatus["setups"][number],
    actionId: string,
    values: Record<string, string>,
  ) => {
    setRefreshingProvider(setup.id);
    setProviderError(undefined);
    try {
      const api = await workspace.api();
      const status = await api.runExtensionSetupAction({
        extensionId: setup.extensionId,
        setupId: setup.id,
        actionId,
        values: setup.inputFields.map((id) => ({ id, value: values[id] ?? "" })),
      });
      setProviderSetups(status.setups.filter((item) => item.modelProvider));
      if (status.authorizationUrl) workspace.requestBrowserUse(status.authorizationUrl);
      await runtime.load();
      return true;
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : t("catalog.modelRefreshFailed"));
      return false;
    } finally {
      setRefreshingProvider(undefined);
    }
  };
  const [localModels, setLocalModels] = useState<OnboardingModelOption[]>([]);
  const [localError, setLocalError] = useState<string>();
  const refreshLocal = async () => {
    try {
      const catalog = await (await workspace.api()).ollamaModels();
      setLocalModels(catalog.models);
      setLocalError(undefined);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  useEffect(() => {
    void refreshLocal();
    return workspace.observeOllamaModelChanged((event) => {
      if (event.status === "succeeded") void refreshLocal();
    });
  }, []);
  const save = async () => {
    await invoke((api) =>
      api.upsertModel({
        id,
        label,
        provider,
        remoteId,
        enabled: true,
        agentIds,
      }),
    );
    setId("");
    setLabel("");
    setProvider("");
    setRemoteId("");
    setAgentIds(["ovule"]);
  };
  return (
    <CatalogSection title={t("catalog.modelCatalog")} note={t("catalog.modelNote")}>
      <OllamaSetup />
      {providerSetups.map((setup) => (
        <IsolatedSetup
          key={`${setup.extensionId}:${setup.id}`}
          setup={setup}
          busy={Boolean(refreshingProvider)}
          progress={refreshingProvider === setup.id ? "Working…" : ""}
          onOpen={(url) => workspace.requestBrowserUse(url)}
          onAction={(id, values) => refreshProvider(setup, id, values)}
        />
      ))}
      {providerError && (
        <div className={styles.catalogError} role="alert">
          {providerError}
        </div>
      )}

      {localModels.length > 0 && (
        <div className={styles.catalogDiscoveredModels}>
          <div className={styles.catalogDiscoveredHeader}>
            <strong>{t("catalog.discoveredOllamaModels")}</strong>
            <Button size="sm" variant="ghost" onClick={() => void refreshLocal()}>
              <RefreshCw size={12} /> {t("catalog.refreshToolchains")}
            </Button>
          </div>
          {localModels.map((model) => (
            <Button
              variant="ghost"
              size="sm"
              key={model.id}
              type="button"
              className={styles.catalogDiscoveredModel}
              onClick={() => {
                setId(`local-${model.id.replace(/[^a-zA-Z0-9._-]/g, "-")}`);
                setLabel(model.label.replace(/ · local$/, ""));
                setProvider("ollama");
                setRemoteId(model.remoteId);
                setAgentIds(["ovule"]);
              }}
            >
              <span className={cn(styles.health, styles.ok)} />
              {model.label}
            </Button>
          ))}
        </div>
      )}
      {localError && <div className={styles.catalogError}>{localError}</div>}
      <CatalogForm>
        <Field label={t("catalog.id")}>
          <Input
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder={t("catalog.modelIdPlaceholder")}
          />
        </Field>
        <Field label={t("catalog.label")}>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t("catalog.modelLabelPlaceholder")}
          />
        </Field>
        <Field label={t("catalog.provider")}>
          <Input
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="openai"
          />
        </Field>
        <Field label={t("catalog.remoteModel")}>
          <Input
            value={remoteId}
            onChange={(event) => setRemoteId(event.target.value)}
            placeholder="provider/model-name"
          />
        </Field>
        <CheckList
          label={t("catalog.compatibleAgents")}
          items={drivers}
          selected={agentIds}
          onChange={setAgentIds}
        />
        <FormActions
          busy={busy}
          valid={Boolean(id && label && provider && remoteId && agentIds.length)}
          save={save}
        />
      </CatalogForm>
      <CardList>
        {snapshot.models.map((model) => (
          <CatalogCard
            key={model.id}
            title={model.label}
            meta={`${model.provider} · ${model.remoteId} · ${model.agentIds.join(", ")}`}
            healthy={model.enabled}
            enabled={model.enabled}
            detail={`${model.enabled ? t("catalog.enabled") : t("catalog.disabled")}${
              model.description ? ` · ${model.description}` : ""
            }${model.extensionId ? ` · ${model.extensionId}` : ""}`}
            onToggle={() =>
              void invoke((api) => api.upsertModel({ ...model, enabled: !model.enabled }))
            }
            onDelete={
              model.extensionId ? undefined : () => void invoke((api) => api.removeModel(model.id))
            }
          />
        ))}
      </CardList>
    </CatalogSection>
  );
}

export const ModelsSectionFactory = create((dependsOn) => {
  const OllamaSetup = dependsOn(settingsTokens.ollamaSetupView);
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { OllamaSetup, workspace };
  return function ModelsSection(props: Props) {
    return createElement(ModelsSectionContent, { dependencies, props });
  };
}, "ModelsSection");

export const ModelsSection = (...args: Parameters<ServiceOf<typeof ModelsSectionFactory>>) =>
  createElement(useService(ModelsSectionFactory), ...args);

function agentDriverOptions(
  snapshot: ViewData,
  extensions?: ExtensionCatalogView,
): Array<{ id: string; label: string }> {
  const labels = new Map<string, string>();
  for (const agent of extensions?.agents ?? []) labels.set(agent.id, agent.label);
  for (const agent of snapshot.agents) {
    if (!labels.has(agent.driver)) labels.set(agent.driver, agent.label);
  }
  labels.set("ovule", "Ovule");
  return [...labels].map(([id, label]) => ({ id, label }));
}
