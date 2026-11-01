/** Durable event projection. Old attempts and malformed/unknown schemas remain readable. */
type Event = { kind: string; detail: string; occurredAt: number };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const label = (value: unknown) => (typeof value === "string" ? value.slice(0, 256) : "unknown");
export function parseHarnessEvent(event: Pick<Event, "kind" | "detail">): RecordValue | undefined {
  if (!event.kind.startsWith("harness/") || event.detail.length > 65_536) return undefined;
  try {
    const value: unknown = JSON.parse(event.detail);
    return record(value) && value.schema_version === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}
export function harnessTelemetry(events: Event[]) {
  let manifest: RecordValue | undefined;
  const calls: Array<{
    tool: string;
    operation: string;
    status: string;
    durationMs: number;
    inputBytes: number;
    outputBytes: number;
    occurredAt: number;
    callId: string;
  }> = [];
  const execution: Array<{
    tool: string;
    status: string;
    failureKind: string;
    callId: string;
    durationMs: number;
    occurredAt: number;
  }> = [];
  const approvals: Array<{
    tool: string;
    status: string;
    mode?: "ask" | "review";
    occurredAt: number;
  }> = [];
  let invalidEvents = 0;
  const warnings: string[] = [];
  for (const event of events) {
    if (!event.kind.startsWith("harness/")) continue;
    const value = parseHarnessEvent(event);
    if (!value) {
      invalidEvents++;
      continue;
    }
    if (event.kind === "harness/assembled") manifest = value;
    else if (event.kind === "harness/failed")
      warnings.push(`${label(value.phase)}: ${label(value.code)}`);
    else if (event.kind === "harness/execution")
      execution.push({
        tool: label(value.tool),
        status: label(value.status),
        failureKind: label(value.failure_kind ?? ""),
        callId: label(value.call_id ?? ""),
        durationMs: number(value.duration_ms),
        occurredAt: event.occurredAt,
      });
    else if (event.kind === "harness/approval")
      approvals.push({
        tool: label(value.tool),
        status: label(value.status),
        ...(value.mode === "ask" || value.mode === "review" ? { mode: value.mode } : {}),
        occurredAt: event.occurredAt,
      });
    else if (event.kind === "harness/tool")
      calls.push({
        tool: label(value.tool),
        operation: label(value.operation),
        status: label(value.status),
        durationMs: number(value.duration_ms),
        inputBytes: number(value.input_bytes),
        outputBytes: number(value.output_bytes),
        occurredAt: event.occurredAt,
        callId: label(String(value.call_id ?? "")),
      });
  }
  const tools = new Map<
    string,
    {
      tool: string;
      calls: number;
      failures: number;
      durationMs: number;
      inputBytes: number;
      outputBytes: number;
    }
  >();
  for (const call of calls) {
    const summary = tools.get(call.tool) ?? {
      tool: call.tool,
      calls: 0,
      failures: 0,
      durationMs: 0,
      inputBytes: 0,
      outputBytes: 0,
    };
    summary.calls++;
    summary.failures += Number(call.status !== "succeeded");
    summary.durationMs += call.durationMs;
    summary.inputBytes += call.inputBytes;
    summary.outputBytes += call.outputBytes;
    tools.set(call.tool, summary);
  }
  if (Array.isArray(manifest?.warnings))
    warnings.push(
      ...manifest.warnings
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.slice(0, 1024)),
    );
  return {
    version: manifest ? label(manifest.harness_version) : undefined,
    route: manifest ? label(manifest.route) : undefined,
    contextUsed: number(manifest?.context_used_chars),
    contextBudget: number(manifest?.context_budget_chars),
    bindings: Array.isArray(manifest?.bindings)
      ? manifest.bindings.filter(record).map((binding) => ({
          id: label(binding.id),
          projection: label(binding.projection),
          available: binding.available === true,
          reason: label(binding.reason),
        }))
      : [],
    skills: Array.isArray(manifest?.skills)
      ? manifest.skills.filter(record).map((skill) => ({
          id: label(skill.id),
          name: label(skill.name),
          revision: label(skill.revision),
        }))
      : [],
    memoryScopes: Array.isArray(manifest?.memory_scopes)
      ? manifest.memory_scopes.filter((value): value is string => typeof value === "string")
      : [],
    calls,
    execution,
    approvals,
    tools: [...tools.values()],
    warnings,
    invalidEvents,
    totalCalls: calls.length,
    failures: calls.filter((call) => call.status !== "succeeded").length,
    toolDurationMs: calls.reduce((sum, call) => sum + call.durationMs, 0),
    // A bounded persisted timeline is a diagnostic sample, not total token/cost accounting.
    retainedTimeline: events.filter((event) => event.kind.startsWith("harness/")).length >= 256,
  };
}
