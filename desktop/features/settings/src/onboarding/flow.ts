import type { OnboardingStatus } from "@ovule/shell-api";

/** CLI agents own their model choice; only Ovule profiles need model IDs. */
export function onboardingReadiness(
  status: Pick<OnboardingStatus, "agents" | "models" | "setups">,
  agentIds: readonly string[],
  defaultAgentId: string,
  modelIds: Readonly<Record<string, string>>,
) {
  const pendingAgents: string[] = [];
  const pendingProfiles: string[] = [];
  for (const id of agentIds) {
    const agent = status.agents.find((candidate) => candidate.id === id);
    if (agent?.driver === "ovule") {
      if (!status.models.some((model) => model.id === modelIds[id] && model.available))
        pendingProfiles.push(id);
    } else if (
      !agent?.available ||
      status.setups.some((setup) => setup.agentIds.includes(id) && !setup.status.authenticated)
    ) {
      pendingAgents.push(id);
    }
  }
  return {
    pendingAgents,
    pendingProfiles,
    complete:
      agentIds.length > 0 &&
      agentIds.includes(defaultAgentId) &&
      pendingAgents.length === 0 &&
      pendingProfiles.length === 0,
  };
}
