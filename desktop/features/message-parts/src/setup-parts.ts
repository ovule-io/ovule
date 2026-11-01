import type { MessagePartView } from "@ovule/shell-api";

/** The host-owned live setup card supersedes model-authored copies in a reply. */
export function uniqueSetupParts(parts: MessagePartView[]): MessagePartView[] {
  const host = parts.find(
    (part) => part.kind === "channel-setup" && part.id.endsWith("setup-status"),
  );
  const preferred =
    host ??
    parts.find((part) => {
      if (part.kind !== "channel-setup") return false;
      try {
        return Boolean(JSON.parse(part.dataJson ?? "{}").connections?.length);
      } catch {
        return false;
      }
    }) ??
    parts.find((part) => part.kind === "channel-setup");
  return parts.filter((part) => part.kind !== "channel-setup" || part === preferred);
}
