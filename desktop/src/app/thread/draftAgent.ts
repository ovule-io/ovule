import type { AgentView, HostView } from "@ovule/shell-api";

export function resolveDraftAgent(
  agents: AgentView[],
  hosts: HostView[],
  hostId: string,
  chosen: string,
  configuredDefault: string,
): string {
  const allowed = hosts.find((host) => host.id === hostId)?.agentIds ?? [];
  const candidates = agents.filter((agent) => agent.enabled && allowed.includes(agent.id));
  return (
    [chosen, configuredDefault, ...candidates.map((agent) => agent.id)].find((id) =>
      candidates.some((agent) => agent.id === id),
    ) ?? ""
  );
}
