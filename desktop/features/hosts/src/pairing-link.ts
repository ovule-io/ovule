export type WorkspacePairingLink = {
  endpointAddrJson: string;
  endpointId: string;
  shareId: string;
  name: string;
  alias: string;
};

export function parseWorkspacePairingLink(source: string): WorkspacePairingLink {
  const url = new URL(source.trim());
  if (url.protocol !== "ovule:" || url.hostname !== "app" || url.pathname !== "/hosts/link")
    throw new Error("Expected a Ovule Link");
  if (url.username || url.password) throw new Error("Links cannot contain credentials");
  for (const forbidden of ["secret", "password", "private_key", "token"])
    if (url.searchParams.has(forbidden)) throw new Error("Links cannot contain credentials");
  const endpointId = required(url.searchParams.get("endpoint"), "host identity");
  const shareId = required(url.searchParams.get("share"), "pairing invitation");
  const endpointAddrJson = decodeBase64Url(required(url.searchParams.get("address"), "address"));
  const parsed = JSON.parse(endpointAddrJson) as { id?: string };
  if (parsed.id !== endpointId) throw new Error("Link host identity does not match its address");
  const name = url.searchParams.get("name")?.trim() || "Remote Host";
  return {
    endpointAddrJson,
    endpointId,
    shareId,
    name,
    alias: url.searchParams.get("alias")?.trim() || name,
  };
}

export function createWorkspacePairingLink(value: WorkspacePairingLink): string {
  const url = new URL("ovule://app/hosts/link");
  url.searchParams.set("endpoint", required(value.endpointId, "host identity"));
  url.searchParams.set("share", required(value.shareId, "pairing invitation"));
  url.searchParams.set("address", encodeBase64Url(required(value.endpointAddrJson, "address")));
  if (value.name) url.searchParams.set("name", value.name);
  if (value.alias) url.searchParams.set("alias", value.alias);
  return url.toString();
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function required(value: string | null, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Link is missing ${label}`);
  return normalized;
}
