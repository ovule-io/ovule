import { test, expect } from "bun:test";
import { harnessTelemetry } from "./harness-telemetry";
const event = (kind: string, value: unknown) => ({
  kind,
  detail: JSON.stringify(value),
  occurredAt: 100,
});
test("harness diagnostics preserve assembly, failures and actual byte/duration metrics", () => {
  const result = harnessTelemetry([
    event("harness/assembled", {
      schema_version: 1,
      harness_version: "ovule-harness/2",
      route: "rig",
      context_used_chars: 100,
      context_budget_chars: 1000,
      bindings: [{ id: "memory", projection: "rig_direct", available: true }],
      skills: [{ id: "s", name: "review", revision: "sha" }],
      memory_scopes: ["thread:x"],
    }),
    event("harness/tool", {
      schema_version: 1,
      tool: "ovule_memory",
      operation: "search",
      status: "succeeded",
      duration_ms: 12,
      input_bytes: 10,
      output_bytes: 20,
    }),
    event("harness/tool", {
      schema_version: 1,
      tool: "ovule_memory",
      operation: "get",
      status: "failed",
      duration_ms: 3,
      input_bytes: 5,
      output_bytes: 0,
    }),
    event("harness/tool", { schema_version: 99 }),
    { kind: "harness/tool", detail: "invalid", occurredAt: 0 },
  ]);
  expect(result.version).toBe("ovule-harness/2");
  expect(result.failures).toBe(1);
  expect(result.totalCalls).toBe(2);
  expect(result.toolDurationMs).toBe(15);
  expect(result.tools[0].outputBytes).toBe(20);
  expect(result.invalidEvents).toBe(2);
});
test("legacy and malformed records do not break message debug", () => {
  expect(harnessTelemetry([]).version).toBeUndefined();
  expect(harnessTelemetry([event("harness/assembled", null)]).invalidEvents).toBe(1);
});

test("execution and permission records do not double count tool calls or copy request bodies", () => {
  const result = harnessTelemetry([
    event("harness/approval", {
      schema_version: 1,
      tool: "external",
      status: "denied",
      arguments: { secret: "private" },
    }),
    event("harness/execution", {
      schema_version: 1,
      tool: "read",
      status: "failed",
      failure_kind: "Cancelled",
      call_id: "journal-id",
      duration_ms: 8,
    }),
  ]);
  expect(result.totalCalls).toBe(0);
  expect(result.approvals[0].status).toBe("denied");
  expect(result.execution[0].callId).toBe("journal-id");
  expect(JSON.stringify(result)).not.toContain("private");
});

test("mixed execution and permission events expose a bounded timeline", () => {
  const events = Array.from({ length: 256 }, (_, index) =>
    event(index % 2 ? "harness/approval" : "harness/execution", {
      schema_version: 1,
      tool: "read",
      status: "completed",
    }),
  );
  expect(harnessTelemetry(events).retainedTimeline).toBe(true);
  expect(harnessTelemetry(events).totalCalls).toBe(0);
});

test("approval telemetry preserves review mode and policy decisions without request bodies", () => {
  const result = harnessTelemetry([
    event("harness/approval", {
      schema_version: 1,
      tool: "host",
      mode: "review",
      status: "approved_by_policy",
      arguments: { secret: "private" },
    }),
  ]);
  expect(result.approvals[0].mode).toBe("review");
  expect(result.approvals[0].status).toBe("approved_by_policy");
  expect(JSON.stringify(result.approvals)).not.toContain("private");
});
