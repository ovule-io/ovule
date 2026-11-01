import type { GoalView, NodeView } from "@ovule/shell-api";

export type LarkGateKind = "authorization" | "credentials" | "pair";
export type GateConnection = {
  connectionId: string;
  boundThreadId?: string;
  botName?: string;
  appIdHint?: string;
  configured?: boolean;
  provisioned?: boolean;
  connected?: boolean;
  ownerPaired?: boolean;
  pairingCode?: string;
  state?: string;
  detail?: string;
};

// Legacy model-derived plans have no typed requirement field. Match only known
// Lark setup requirements, never arbitrary approval or installation Gates.
export function larkGateKind(
  goal: Pick<GoalView, "title" | "intent">,
  node: Pick<NodeView, "kind" | "title">,
): LarkGateKind | undefined {
  if (node.kind !== "gate" || !/lark|feishu|飞书/i.test(`${goal.title} ${goal.intent}`)) return;
  if (/\/pair\b|所有者配对|owner.*pair|pair.*owner/i.test(node.title)) return "pair";
  if (/应用密钥|连接凭据|app secret|connection credentials/i.test(node.title)) return "credentials";
  if (/授权|应用权限|authoriz|app.*permission/i.test(node.title)) return "authorization";
}

export function gateVerified(kind: LarkGateKind, connection: GateConnection): boolean {
  if (connection.state === "error") return false;
  if (kind === "pair") return connection.connected === true && connection.ownerPaired === true;
  if (kind === "credentials")
    return connection.configured === true && connection.connected === true;
  return connection.configured === true && connection.provisioned === true;
}

export function gateConnectionId(
  connections: GateConnection[],
  threadId: string,
): string | undefined {
  const bound = connections.filter((item) => item.boundThreadId === threadId);
  if (bound.length === 1) return bound[0].connectionId;
  if (connections.length === 1) return connections[0].connectionId;
  if (!connections.length) return "default";
}
