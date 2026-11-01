import workspaceTokens from "@ovule/workspace/workspace.token";
import settingsTokens from "@ovule/settings/settings.token";
import type { ViewData } from "./view-data";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input, Textarea } from "@ovule/ui/form";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import type { AgentView, ExtensionCatalogView, OnboardingModelOption } from "@ovule/shell-api";
import {
  agentModelOptions,
  catalogModelOption,
  compatibleModelAgent,
  discoveredModelCatalogId,
  modelKey,
} from "./catalog-models";
import { useService } from "@ovule/ioc/react";
import { cn } from "@ovule/ui/cn";
import styles from "@ovule/ui/SettingsSection.module.css";
import {
  CatalogSection,
  CatalogForm,
  Field,
  Check,
  CheckList,
  FormActions,
  CardList,
  CatalogCard,
} from "@ovule/ui/SettingsSection";
import type { SettingsSectionProps as Props } from "@ovule/settings/settings/settings";
type AgentsSectionDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function AgentsSectionContent({
  dependencies,
  props,
}: {
  dependencies: AgentsSectionDependencies;
  props: Props;
}) {
  const useExtensionCatalog = useService(settingsTokens.extensionCatalogHook);

  const { workspace } = dependencies;
  const { snapshot, busy, invoke } = props;

  const { t } = useTranslation();
  const { catalog: extensions } = useExtensionCatalog();
  const [editing, setEditing] = useState<AgentView>();
  const [showForm, setShowForm] = useState(false);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [driver, setDriver] = useState("codex");
  const [modelId, setModelId] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [discoveredModels, setDiscoveredModels] = useState<OnboardingModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState<string>();
  const drivers = agentDriverOptions(snapshot, extensions);
  const refreshModels = async () => {
    setModelsLoading(true);
    try {
      const status = await (await workspace.api()).onboardingStatus();
      setDiscoveredModels(status.models);
      setModelError(undefined);
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModelsLoading(false);
    }
  };
  useEffect(() => {
    void refreshModels();
  }, []);
  const modelOptions = agentModelOptions(snapshot.models, discoveredModels, driver, modelId);
  const edit = (agent?: AgentView) => {
    setShowForm(Boolean(agent));
    setEditing(agent);
    setId(agent?.id ?? "");
    setLabel(agent?.label ?? "");
    setDriver(agent?.driver ?? "codex");
    setModelId(agent?.modelId ?? "");
    setSkillIds(agent?.skillIds ?? []);
    setToolIds(agent?.toolIds ?? []);
    setInstructions(agent?.instructions ?? "");
    setEnabled(agent?.enabled ?? true);
  };
  const create = () => {
    edit();
    setShowForm(true);
  };
  const save = async () => {
    const saved = await invoke(async (api) => {
      let persistedModelId = modelId || undefined;
      const discoveredModel = discoveredModels.find((model) => model.id === modelId);
      if (discoveredModel && !snapshot.models.some((model) => model.id === modelId)) {
        const catalogModel = snapshot.models.find(
          (model) =>
            modelKey(catalogModelOption(model)) ===
            modelKey({
              ...discoveredModel,
              agentIds: discoveredModel.agentId ? [discoveredModel.agentId] : [driver],
            }),
        );
        persistedModelId = catalogModel?.id ?? discoveredModelCatalogId(discoveredModel);
        if (!catalogModel) {
          await api.upsertModel({
            id: persistedModelId,
            label: discoveredModel.label,
            provider: discoveredModel.provider,
            remoteId: discoveredModel.remoteId,
            enabled: true,
            agentIds: discoveredModel.agentId ? [discoveredModel.agentId] : [driver],
          });
        }
      }
      return api.upsertAgent({
        id,
        label,
        driver,
        modelId: persistedModelId,
        skillIds,
        toolIds,
        instructions,
        enabled,
      });
    });
    if (saved) {
      edit();
      setShowForm(false);
    }
  };
  return (
    <CatalogSection title={t("catalog.agentProfiles")} note={t("catalog.agentNote")} onAdd={create}>
      {showForm ? (
        <CatalogForm>
          <Field label={t("catalog.id")}>
            <Input
              value={id}
              disabled={Boolean(editing)}
              onChange={(event) => setId(event.target.value)}
              placeholder={t("catalog.agentIdPlaceholder")}
            />
          </Field>
          <Field label={t("catalog.label")}>
            <Input
              value={label}
              disabled={Boolean(editing?.extensionId)}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t("catalog.agentLabelPlaceholder")}
            />
          </Field>
          <Field label={t("catalog.driver")}>
            <Select
              value={driver}
              disabled={Boolean(editing?.extensionId)}
              onValueChange={(value) => {
                setDriver(value);
                const selected = modelOptions.find((model) => model.id === modelId);
                if (selected && !compatibleModelAgent(selected, value)) setModelId("");
              }}
            >
              <SelectTrigger aria-label={t("catalog.driver")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("catalog.model")}>
            <Select
              value={modelId || "__default__"}
              onValueChange={(value) => setModelId(value === "__default__" ? "" : value)}
            >
              <SelectTrigger aria-label={t("catalog.model")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">{t("catalog.defaultModel")}</SelectItem>
                {modelOptions.map((model) => (
                  <SelectItem key={model.id} value={model.id} disabled={!model.available}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className={styles.catalogModelDiscovery}>
            <Button
              size="sm"
              variant="ghost"
              disabled={modelsLoading}
              onClick={() => void refreshModels()}
            >
              <RefreshCw className={modelsLoading ? styles.spin : undefined} size={12} />
              {t("catalog.refreshModels")}
            </Button>
            {modelError && (
              <small className={cn(styles.catalogError, styles.catalogModelDiscoveryError)}>
                {modelError}
              </small>
            )}
          </div>
          <CheckList
            label={t("catalog.skills")}
            items={snapshot.skills.map((item) => ({
              id: item.id,
              label: item.name,
            }))}
            selected={skillIds}
            onChange={setSkillIds}
          />
          <CheckList
            label={t("catalog.mcpTools")}
            items={snapshot.tools.map((item) => ({
              id: item.id,
              label: item.label,
            }))}
            selected={toolIds}
            onChange={setToolIds}
          />
          <Field label={t("catalog.instructions")} full>
            <Textarea
              className={styles.catalogTextarea}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={t("catalog.instructionsPlaceholder")}
            />
          </Field>
          <Check label={t("catalog.enabledField")} checked={enabled} onChange={setEnabled} />
          <FormActions
            busy={busy}
            valid={Boolean(id.trim() && label.trim())}
            save={save}
            cancel={() => {
              edit();
              setShowForm(false);
            }}
          />
        </CatalogForm>
      ) : null}
      <CardList>
        {snapshot.agents.map((agent) => (
          <CatalogCard
            key={agent.id}
            title={agent.label}
            meta={`${agent.driver} · ${agent.modelId ?? t("catalog.defaultModelMeta")}`}
            healthy={agent.available}
            detail={`${agent.detail}${agent.extensionId ? ` · ${agent.extensionId}` : ""}`}
            onEdit={() => edit(agent)}
            onDelete={
              agent.extensionId || agent.id === "ovule"
                ? undefined
                : () => void invoke((api) => api.removeAgent(agent.id))
            }
          />
        ))}
      </CardList>
    </CatalogSection>
  );
}

export const AgentsSectionFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function AgentsSection(props: Props) {
    return createElement(AgentsSectionContent, { dependencies, props });
  };
}, "AgentsSection");

export const AgentsSection = (...args: Parameters<ServiceOf<typeof AgentsSectionFactory>>) =>
  createElement(useService(AgentsSectionFactory), ...args);

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
