import type { ThreadMessageView } from "@ovule/shell-api";
const stopped = new Set([
  "Agent Worker was cancelled before it started",
  "Agent Worker was cancelled",
  "Generation stopped",
  "Cancelled before Worker dispatch",
]);
/** Keep old stored cancellations readable without repeating their inaccurate summary. */
export function messageNotice(message: ThreadMessageView) {
  const notice = message.parts.find((part) => part.kind === "notice")?.text ?? undefined;
  const legacy =
    message.status === "error" || message.role === "system"
      ? message.parts.find(
          (part) => part.kind === "markdown" && stopped.has(part.text?.trim() ?? ""),
        )?.text
      : undefined;
  const cancelled = message.status === "cancelled" || Boolean(legacy);
  return {
    cancelled,
    text: notice ?? legacy ?? undefined,
    parts: message.parts.filter(
      (part) =>
        part.kind !== "notice" &&
        !(part.kind === "markdown" && (part.text === notice || part.text === legacy)),
    ),
  };
}
