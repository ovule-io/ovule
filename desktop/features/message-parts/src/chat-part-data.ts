import type { ToolState } from "@ovule/ui/tool";
/** Structured parts are data, never HTML or executable terminal commands. */
export function chatPartData(value?: string | null): Record<string, unknown> {
  if (!value || value.length > 256 * 1024) return {};
  try {
    const data = JSON.parse(value);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
export function chatText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
}
export function chatToolState(value: unknown, streaming: boolean): ToolState {
  if (["completed", "succeeded", "output-available"].includes(String(value))) return "completed";
  if (value === "error") return "error";
  if (["failed", "output-error"].includes(String(value))) return "failed";
  if (["cancelled", "canceled", "output-denied"].includes(String(value))) return "cancelled";
  if (!streaming) return "cancelled";
  return ["running", "in_progress", "input-available"].includes(String(value))
    ? "running"
    : "pending";
}

/** Separate a returned tool failure from failures to dispatch or complete the invocation. */
export function chatToolPresentation(
  data: Record<string, unknown>,
  streaming: boolean,
  resultPart = false,
): ToolState {
  const state = chatToolState(
    data.state ?? data.status ?? (resultPart ? "completed" : undefined),
    streaming,
  );
  if (state === "cancelled") return state;
  const output = data.output ?? data.result;
  const record =
    output && typeof output === "object" ? (output as Record<string, unknown>) : undefined;
  const kind = String(data.failureKind ?? record?.failureKind ?? "").toLowerCase();
  const exit = record?.exit_code;
  const failed =
    state === "failed" ||
    state === "error" ||
    record?.isError === true ||
    (typeof exit === "number" && exit !== 0);
  if (!failed) return state;
  if (["process", "process_failed", "process_terminated"].includes(kind)) return "failed";
  if (
    [
      "backend",
      "timeout",
      "unavailable",
      "denied",
      "permissiondenied",
      "permission_denied",
    ].includes(kind)
  )
    return "error";
  if (typeof exit === "number" && exit !== 0) return "failed";
  return output !== undefined ? "failed" : "error";
}
