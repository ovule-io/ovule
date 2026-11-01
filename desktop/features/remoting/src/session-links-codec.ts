import type { SpiceSessionRequest, LinkRemoteControlSessionRequest } from "./session-links";
const PREFIX = "spice-session:";
const LINK_PREFIX = "remote-control-session:";

export function spiceWebsocketUrlError(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    const loopback =
      url.protocol === "ws:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    if (url.protocol !== "wss:" && !loopback) return "spice.secureWebsocketRequired";
    if (!url.hostname || url.username || url.password || url.search || url.hash) {
      return "spice.invalidWebsocketUrl";
    }
    return undefined;
  } catch {
    return "spice.invalidWebsocketUrl";
  }
}

export function encodeSpiceSession(request: SpiceSessionRequest): string {
  return `${PREFIX}${encodeURIComponent(JSON.stringify(request))}`;
}

export function decodeSpiceSession(value?: string): SpiceSessionRequest | undefined {
  if (!value?.startsWith(PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(PREFIX.length))) as unknown;
    if (!isRecord(parsed)) return undefined;
    const endpointId = boundedText(parsed.endpointId, 128);
    const displayName = boundedText(parsed.displayName, 160);
    const websocketUrl = boundedText(parsed.websocketUrl, 2_048);
    if (!endpointId || !displayName || !websocketUrl || spiceWebsocketUrlError(websocketUrl)) {
      return undefined;
    }
    return {
      endpointId,
      displayName,
      websocketUrl: new URL(websocketUrl).href,
    };
  } catch {
    return undefined;
  }
}

export function encodeLinkRemoteControlSession(request: LinkRemoteControlSessionRequest): string {
  return `${LINK_PREFIX}${encodeURIComponent(JSON.stringify(request))}`;
}

export function decodeLinkRemoteControlSession(
  value?: string,
): LinkRemoteControlSessionRequest | undefined {
  if (!value?.startsWith(LINK_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(LINK_PREFIX.length))) as unknown;
    if (!isRecord(parsed)) return undefined;
    const endpointId = boundedText(parsed.endpointId, 128);
    const displayName = boundedText(parsed.displayName, 160);
    return endpointId && displayName ? { endpointId, displayName } : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
