import { expect, test } from "bun:test";
import type { AttemptView, ThreadMessageView } from "@ovule/shell-api";
import {
  buildMessageTelemetry,
  diagnoseMessage,
  formatDiagnosticReport,
  redactDiagnosticText,
} from "./diagnostic-report";

const message = (
  content: string,
  parts = [{ id: "markdown", kind: "markdown", text: content }],
): ThreadMessageView => ({
  id: "reply",
  threadId: "thread",
  role: "assistant",
  status: "complete",
  content,
  parts,
  createdAt: 100,
  streamSequence: 1n,
  attemptId: "attempt",
});
const attempt = (summary: string): AttemptView =>
  ({
    id: "attempt",
    threadId: "thread",
    agent: "ovule",
    hostId: "local",
    purpose: "message",
    status: "failed",
    summary,
    output: summary,
    outputSequence: 1n,
    createdAt: 1,
    sourceMessageId: "source",
    events: [],
    modelProvider: "deepseek",
    modelRemoteId: "original-model",
  }) as AttemptView;

test("classifies the observed legacy empty ACP reply and 32-round failure", () => {
  expect(diagnoseMessage(message("ACP Agent completed (EndTurn)"))[0].code).toBe(
    "empty_final_answer",
  );
  expect(
    diagnoseMessage(
      message('Internal error: "deepseek exceeded the limit of 32 tool-call rounds"'),
    )[0].code,
  ).toBe("tool_round_limit");
  expect(
    diagnoseMessage({ ...message("", [{ id: "ui", kind: "interactive-ui", text: "" }]) }),
  ).toEqual([]);
  expect(diagnoseMessage({ ...message("", []), status: "streaming" })).toEqual([]);
});

test("a copied bundle includes bounded same-thread context, original model, and explicit journal availability", () => {
  const report = buildMessageTelemetry({
    message: message("ACP Agent completed (EndTurn)"),
    attempt: attempt("empty"),
    snapshotRevision: 9n,
    contextMessages: [
      { ...message("User question"), id: "source", role: "user", createdAt: 10 },
      { ...message("Other thread secret"), threadId: "other", createdAt: 10 },
      { ...message("Future answer"), id: "future", createdAt: 200 },
    ],
  });
  const bundle = formatDiagnosticReport({
    ...report,
    executionJournal: { status: "unavailable", records: [] },
  });
  expect(bundle).toContain("Ovule Agent diagnostic v3");
  expect(bundle).toContain("empty_final_answer");
  expect(bundle).toContain("User question");
  expect(bundle).not.toContain("Other thread secret");
  expect(bundle).not.toContain("Future answer");
  expect(bundle).toContain("original-model");
  expect(bundle).toContain('"status": "unavailable"');
  expect(bundle).toContain('"snapshotRevision": "9"');
});

test("credentials and URL query values are redacted without reading environment or SecretStore", () => {
  const value = redactDiagnosticText(
    '{"api_key":"fake-key","Authorization":"Bearer fake-secret","url":"https://alice:password@example.com/path?token=secret#fragment"}',
  );
  const parsed = JSON.parse(value);
  expect(parsed.api_key).toBe("[redacted]");
  expect(value).not.toContain("fake-secret");
  expect(value).not.toContain("password@example");
  expect(parsed.url).toBe("https://example.com/path");
});

test("token-limit evidence is retained and large Unicode payloads are bounded", () => {
  const execution = attempt("empty");
  execution.events = [
    {
      kind: "harness/model_round",
      occurredAt: 10,
      detail: JSON.stringify({
        schema_version: 1,
        round: 1,
        finish_reason: "length",
        text_bytes: 0,
        reasoning_bytes: 28_940,
      }),
    },
  ];
  const report = buildMessageTelemetry({
    message: message("文".repeat(100_000)),
    attempt: execution,
    snapshotRevision: 1n,
  });
  expect(report.findings.some((item) => item.code === "model_output_limit")).toBe(true);
  expect(report.message.content?.truncated).toBe(true);
  expect(new TextEncoder().encode(report.message.content!.value).length).toBeLessThanOrEqual(
    65_536,
  );
  expect(report.message.content!.value).not.toContain("\uFFFD");
});

test("recognizes the pasted legacy Length failure without inventing missing token usage", () => {
  const reply = message(
    'Internal error: "deepseek returned no answer (finish reason: Some(Length)). Reasoning alone is not a completed reply"',
  );
  const findings = diagnoseMessage(reply, attempt(reply.content));
  expect(findings.map((item) => item.code)).toEqual(["empty_final_answer", "model_output_limit"]);
  expect(findings[1].evidence).toContain("no per-round token metrics");
  expect(diagnoseMessage(message("The output length is 8192 characters."))).toEqual([]);
});

test("completed tool lifecycles still classify failed commands and access warnings", () => {
  const item = message("Some checks remain incomplete.");
  item.parts = [
    {
      id: "one",
      kind: "tool",
      dataJson: JSON.stringify({
        name: "ovule_workspace_exec",
        state: "completed",
        output: { exit_code: -1, stderr: "rosetta error" },
      }),
    },
    {
      id: "two",
      kind: "tool",
      dataJson: JSON.stringify({
        name: "ovule_workspace_exec",
        state: "completed",
        output: { exit_code: 0, warnings: ["access_denial_observed: permission denied"] },
      }),
    },
  ];
  const codes = diagnoseMessage(item).map((item) => item.code);
  expect(codes).toContain("process_execution_failed");
  expect(codes).toContain("execution_access_denied");
});

test("approval timeouts report absent presentation separately from user denial", () => {
  const execution = attempt("Permission unresolved");
  execution.events = [
    {
      kind: "harness/approval",
      occurredAt: 1,
      detail: JSON.stringify({ schema_version: 1, status: "timed_out", presented: false }),
    },
  ];
  const finding = diagnoseMessage(message("No diagnostic was completed"), execution).find(
    (value) => value.code === "approval_timed_out",
  );
  expect(finding?.evidence).toContain("no card presentation acknowledgement");
  expect(finding?.evidence).toContain("not a user denial");
});
