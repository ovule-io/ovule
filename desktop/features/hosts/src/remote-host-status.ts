export type RemoteHostStatus = {
  phase: "checking" | "online" | "reconnecting" | "offline";
  detail: string;
  failures: number;
  capabilities: string[];
};

const FAILURE_THRESHOLD = 3;

export function nextRemoteHostStatus(
  current: RemoteHostStatus | undefined,
  connected: boolean,
  detail: string,
  capabilities: string[] = [],
): RemoteHostStatus {
  if (connected) return { phase: "online", detail, failures: 0, capabilities };
  const failures = (current?.failures ?? 0) + 1;
  if (failures < FAILURE_THRESHOLD) {
    return {
      phase:
        current?.phase === "online" || current?.phase === "reconnecting"
          ? "reconnecting"
          : "checking",
      detail,
      failures,
      capabilities: current?.capabilities ?? [],
    };
  }
  return {
    phase: "offline",
    detail,
    failures,
    capabilities: current?.capabilities ?? [],
  };
}
