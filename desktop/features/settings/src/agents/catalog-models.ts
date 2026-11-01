import type { ModelView, OnboardingModelOption } from "@ovule/shell-api";

export type AgentModelOption = OnboardingModelOption & { agentIds: string[] };

export const compatibleModelAgent = (model: AgentModelOption, driver: string): boolean =>
  model.agentIds.includes(driver);

export const modelKey = (model: AgentModelOption): string =>
  `${model.agentIds.join(",")}:${model.provider}:${model.remoteId}`;

export function catalogModelOption(model: ModelView): AgentModelOption {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    remoteId: model.remoteId,
    available: model.enabled,
    recommended: model.recommended,
    detail: model.description || "Configured in the Ovule Model catalog",
    agentId: model.agentIds[0],
    agentIds: model.agentIds,
  };
}

export function agentModelOptions(
  catalog: ModelView[],
  discovered: OnboardingModelOption[],
  driver: string,
  selectedId: string,
): AgentModelOption[] {
  const result: AgentModelOption[] = [];
  const keys = new Set<string>();
  for (const model of [
    ...catalog.map(catalogModelOption),
    ...discovered
      .filter((model) => model.available && !model.id.startsWith("default:"))
      .map((model) => ({
        ...model,
        agentIds: model.agentId ? [model.agentId] : [],
      })),
  ]) {
    if (model.id !== selectedId && !compatibleModelAgent(model, driver)) continue;
    const key = modelKey(model);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(model);
  }
  return result;
}

export function discoveredModelCatalogId(model: OnboardingModelOption): string {
  const suffix = model.id
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `discovered-${suffix || "model"}`;
}
