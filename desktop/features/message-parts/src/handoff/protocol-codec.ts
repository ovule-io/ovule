import type { HumanHandoffRequest } from "@ovule/workspace/contract";

import type { HumanHandoffProtocol } from "./protocol";

export function parseHumanHandoff(value: unknown): HumanHandoffRequest | undefined {
  if (!isRecord(value)) return undefined;
  const id = boundedText(value.id, 128);
  const title = boundedText(value.title, 160);
  const instructions = boundedText(value.instructions, 2_000);
  if (!id || !title || !instructions || !/^[a-zA-Z0-9._-]+$/.test(id)) return undefined;
  const protocol: HumanHandoffProtocol = value.protocol === "browser" ? "browser" : "spice";
  const target = safeSessionTarget(value.target);
  const gatewayUrl = safeHttpsUrl(value.gatewayUrl);
  const appshotUrl = safeHttpsUrl(value.appshotUrl);
  if (value.target && !target) return undefined;
  if (value.gatewayUrl && !gatewayUrl) return undefined;
  if (value.appshotUrl && !appshotUrl) return undefined;
  if (protocol === "browser" && !gatewayUrl && !target?.startsWith("https://")) return undefined;
  return {
    id,
    title,
    instructions,
    protocol,
    target,
    gatewayUrl,
    appshotUrl,
    appshotAlt: boundedText(value.appshotAlt, 300),
  };
}

export function encodeHumanHandoff(request: HumanHandoffRequest): string {
  return `handoff:${encodeURIComponent(JSON.stringify(request))}`;
}

export function decodeHumanHandoff(value?: string): HumanHandoffRequest | undefined {
  if (!value?.startsWith("handoff:")) return undefined;
  try {
    return parseHumanHandoff(JSON.parse(decodeURIComponent(value.slice("handoff:".length))));
  } catch {
    return undefined;
  }
}

export function handoffLaunchUrl(request: HumanHandoffRequest): string | undefined {
  return (
    request.gatewayUrl ?? (request.target?.startsWith("https://") ? request.target : undefined)
  );
}

function safeSessionTarget(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const target = value.trim();
  try {
    const url = new URL(target);
    if (!["https:", "spice:", "spice+tls:"].includes(url.protocol)) return undefined;
    if (!url.hostname || url.username || url.password) return undefined;
    if (hasSecretParameters(url)) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && !hasSecretParameters(url)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function hasSecretParameters(url: URL): boolean {
  const secretKeys = new Set([
    "password",
    "token",
    "secret",
    "ticket",
    "apikey",
    "accesstoken",
    "cookie",
    "sessionid",
    "signature",
    "credential",
    "authorization",
  ]);
  return [...url.searchParams.keys()].some((key) => {
    const normalized = key.toLowerCase().replaceAll(/[-_]/g, "");
    return (
      secretKeys.has(normalized) ||
      ["password", "token", "secret", "ticket", "cookie", "signature", "credential"].some(
        (suffix) => normalized.endsWith(suffix),
      )
    );
  });
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maxLength ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
