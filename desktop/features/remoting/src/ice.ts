const CANDIDATE_TYPE = /(?:^|\s)typ\s+(host|srflx|prflx|relay)(?:\s|$)/i;

type CandidateSide = "client" | "host";
type CandidateType = "host" | "srflx" | "prflx" | "relay";

export function hasTurnServer(servers: RTCIceServer[]): boolean {
  return servers.some((server) =>
    (typeof server.urls === "string" ? [server.urls] : server.urls).some((url) =>
      /^turns?:/i.test(url),
    ),
  );
}

export class IceDiagnostics {
  private readonly candidateTypes: Record<CandidateSide, Set<CandidateType>> = {
    client: new Set(),
    host: new Set(),
  };
  private readonly gatheringErrors = new Set<number>();

  private servers: RTCIceServer[] = [];
  private configured = false;
  private providerWarning?: string;

  setProviderWarning(warning?: string): void {
    this.providerWarning = warning;
  }

  setServers(servers: RTCIceServer[]): void {
    this.servers = servers;
    this.configured = true;
  }

  recordCandidate(side: CandidateSide, candidate: string): void {
    const type = CANDIDATE_TYPE.exec(candidate)?.[1]?.toLowerCase() as CandidateType | undefined;
    if (type) this.candidateTypes[side].add(type);
  }

  recordGatheringError(code: number): void {
    if (Number.isFinite(code)) this.gatheringErrors.add(code);
  }

  failureMessage(
    reason = "WebRTC ICE failed",
    connectionState?: RTCPeerConnectionState,
    remoteDescriptionReceived?: boolean,
  ): string {
    if (connectionState === "connected") {
      return `${reason}; ICE connected, so verify Host capture and encoder availability`;
    }
    if (!this.configured) {
      return `${reason}; Host desktop startup or Link signaling did not provide an ICE configuration. Verify Host session startup and the control connection`;
    }
    if (remoteDescriptionReceived === false) {
      return `${reason}; no remote SDP was applied. Verify Host desktop startup and SDP delivery over Link before diagnosing NAT traversal`;
    }
    const client = this.describe("client");
    const host = this.describe("host");
    const errors = this.gatheringErrors.size
      ? `; gathering errors=${[...this.gatheringErrors].sort().join(",")}`
      : "";
    if (this.providerWarning) {
      return `${reason}; relay service unavailable: ${this.providerWarning} (client=${client}; host=${host}${errors})`;
    }
    if (!hasTurnServer(this.servers)) {
      const publicCandidates =
        this.candidateTypes.client.has("srflx") ||
        this.candidateTypes.client.has("prflx") ||
        this.candidateTypes.host.has("srflx") ||
        this.candidateTypes.host.has("prflx");
      return publicCandidates
        ? `${reason}; direct/STUN candidates could not connect, so the Host deployment requires a TURN relay (client=${client}; host=${host}${errors})`
        : `${reason}; the Host provided no TURN relay and STUN produced no usable public candidate. Ask the Host administrator to configure its relay policy (client=${client}; host=${host}${errors})`;
    }
    const relay = this.candidateTypes.client.has("relay") || this.candidateTypes.host.has("relay");
    return relay
      ? `${reason}; relay candidates were gathered but could not connect. Verify TURN reachability from both devices (client=${client}; host=${host}${errors})`
      : `${reason}; the Host TURN policy produced no relay candidate. Verify the deployment URL, credentials, and UDP/TCP/TLS reachability (client=${client}; host=${host}${errors})`;
  }

  private describe(side: CandidateSide): string {
    const types = [...this.candidateTypes[side]].sort();
    return types.length ? types.join("+") : "none";
  }
}

/** Keep only hostnames: ICE URLs and stats must not expose credentials or query tokens. */
export function turnServerLabel(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const host = /^turns?:([a-z0-9.-]+)(?::[0-9]+)?(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
  if (!host) return undefined;
  return host === "cloudflare.com" || host.endsWith(".cloudflare.com")
    ? `Cloudflare (${host})`
    : host;
}
