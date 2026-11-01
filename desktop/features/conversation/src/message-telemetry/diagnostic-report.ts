import type {
  AgentView,
  AttemptView,
  ModelView,
  ThreadMessageView,
  ThreadView,
} from "@ovule/shell-api";
import type { MessageTelemetryRuntime } from "./route";
import { harnessTelemetry, parseHarnessEvent } from "./harness-telemetry";
const MAX_DIAGNOSTIC_TEXT_BYTES = 64 * 1024;

export function diagnoseMessage(message: ThreadMessageView, attempt?: AttemptView) {
  const findings: Array<{ code: string; evidence: string }> = [];
  if (
    /(?:^ACP Agent completed \(|returned no answer|ended without an answer)/.test(
      message.content.trim(),
    ) ||
    (message.role !== "user" &&
      message.status !== "streaming" &&
      message.parts.every(
        (part) => part.kind === "thinking" || (part.kind === "markdown" && !part.text?.trim()),
      ))
  ) {
    findings.push({
      code: "empty_final_answer",
      evidence:
        "No final Markdown answer, or legacy ACP success placeholder; thinking is not an answer.",
    });
  }
  if (
    /limit of \d+ tool-call rounds|tool.*budget.*exhausted/i.test(
      `${message.content} ${attempt?.summary ?? ""}`,
    )
  ) {
    findings.push({ code: "tool_round_limit", evidence: "The execution reached its tool budget." });
  }
  for (const event of attempt?.events ?? []) {
    const value = parseHarnessEvent(event);
    if (event.kind === "harness/approval" && value?.status === "timed_out") {
      findings.push({
        code: "approval_timed_out",
        evidence:
          value.presented === true
            ? "An approval card mounted, but no decision arrived before the deadline. This is not a user denial."
            : "No approval decision arrived before the deadline; there is no card presentation acknowledgement. This is not a user denial.",
      });
    }
    if (event.kind === "harness/model_round" && value) {
      if (/length|max.*token/i.test(String(value.finish_reason)))
        findings.push({
          code: "model_output_limit",
          evidence: `Round ${value.round}: ${value.finish_reason}; text bytes ${value.text_bytes}, reasoning bytes ${value.reasoning_bytes}.`,
        });
      if (value.finalizing)
        findings.push({
          code: "tool_budget_finalization",
          evidence: `Round ${value.round} was reserved for a tool-free final answer.`,
        });
    }
  }
  if (
    !findings.some((item) => item.code === "model_output_limit") &&
    /finish reason:\s*(?:Some\(Length\)|["']?length)/i.test(
      `${message.content} ${attempt?.summary ?? ""}`,
    )
  ) {
    findings.push({
      code: "model_output_limit",
      evidence:
        "The provider reported a length finish reason. This legacy attempt has no per-round token metrics.",
    });
  }
  if ((attempt?.events ?? []).some((event) => event.kind === "harness/answer_recovery")) {
    findings.push({
      code: "answer_recovery",
      evidence:
        "One tool-free final-answer recovery was requested with thinking disabled after an empty length-truncated response.",
    });
  }
  let processFailures = 0;
  let accessDenials = 0;
  for (const part of message.parts) {
    if (part.kind !== "tool" || !part.dataJson || part.dataJson.length > 256 * 1024) continue;
    try {
      const card = JSON.parse(part.dataJson);
      if (card.name !== "ovule_workspace_exec") continue;
      const output = card.output;
      if (typeof output?.exit_code === "number" && output.exit_code !== 0) processFailures++;
      if (
        output?.failureKind === "permission_denied" ||
        (Array.isArray(output?.warnings) &&
          output.warnings.some(
            (warning: unknown) =>
              typeof warning === "string" && warning.startsWith("access_denial_observed"),
          ))
      )
        accessDenials++;
    } catch {
      /* Partial streamed payloads have no reliable classification yet. */
    }
  }
  if (processFailures)
    findings.push({
      code: "process_execution_failed",
      evidence: `${processFailures} commands returned nonzero exit status, independently of tool lifecycle status.`,
    });
  if (accessDenials)
    findings.push({
      code: "execution_access_denied",
      evidence: `${accessDenials} command results contain access-denial evidence; inspect execution policy instead of treating inaccessible paths as absent.`,
    });
  const harness = harnessTelemetry(attempt?.events ?? []);
  if (harness.failures)
    findings.push({
      code: "tool_failures",
      evidence: `${harness.failures} failed tool calls; inspect harness and executionJournal.`,
    });
  return findings;
}

export function buildMessageTelemetry({
  message,
  attempt,
  thread,
  agent,
  model,
  snapshotRevision,
  runtime,
  contextMessages = [],
}: {
  message: ThreadMessageView;
  attempt?: AttemptView;
  thread?: ThreadView;
  agent?: AgentView;
  model?: ModelView;
  snapshotRevision: bigint;
  runtime?: MessageTelemetryRuntime;
  contextMessages?: ThreadMessageView[];
}) {
  return {
    schemaVersion: 3,
    format: "ovule-agent-diagnostic",
    findings: diagnoseMessage(message, attempt),
    harness: harnessTelemetry(attempt?.events ?? []),
    capturedAt: new Date().toISOString(),
    snapshotRevision,
    context: {
      sourceMessageId: attempt?.sourceMessageId ?? null,
      messages: contextMessages
        .filter(
          (item) =>
            item.threadId === message.threadId &&
            item.id !== message.id &&
            item.createdAt <= message.createdAt,
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-4)
        .map((item) => ({
          id: item.id,
          role: item.role,
          status: item.status,
          content: diagnosticText(item.content),
        })),
    },
    message: {
      id: message.id,
      threadId: message.threadId,
      attemptId: message.attemptId ?? null,
      role: message.role,
      status: message.status,
      streamSequence: message.streamSequence,
      createdAt: message.createdAt,
      createdAtEpochMs: message.createdAt,
      content: diagnosticText(message.content),
      contentCharacters: [...message.content].length,
      contentUtf8Bytes: utf8Bytes(message.content),
      parts: message.parts.map((part) => ({
        id: part.id,
        kind: part.kind,
        name: part.name ?? null,
        mediaType: part.mediaType ?? null,
        sizeBytes: part.sizeBytes ?? null,
        text: diagnosticText(part.text),
        textCharacters: part.text == null ? null : [...part.text].length,
        textUtf8Bytes: part.text == null ? null : utf8Bytes(part.text),
        url: diagnosticUrl(part.url),
        dataJson: diagnosticJson(part.dataJson),
      })),
    },
    thread: thread
      ? {
          id: thread.id,
          title: thread.title,
          workspacePath: thread.workspacePath,
          hostId: thread.hostId,
          agentId: thread.agent,
          modelId: thread.modelId ?? null,
        }
      : null,
    execution: attempt
      ? {
          id: attempt.id,
          threadId: attempt.threadId,
          taskId: attempt.taskId ?? null,
          sourceMessageId: attempt.sourceMessageId ?? null,
          responseMessageId: attempt.responseMessageId ?? null,
          purpose: attempt.purpose,
          hostId: attempt.hostId,
          agentId: attempt.agent,
          agentLabel: agent?.label ?? null,
          driver: attempt.driver ?? agent?.driver ?? null,
          modelId: model?.id ?? thread?.modelId ?? null,
          modelProvider: attempt.modelProvider ?? model?.provider ?? null,
          modelRemoteId: attempt.modelRemoteId ?? model?.remoteId ?? null,
          status: attempt.status,
          summary: diagnosticText(attempt.summary),
          output: diagnosticText(attempt.output),
          outputSequence: attempt.outputSequence,
          outputCharacters: [...attempt.output].length,
          outputUtf8Bytes: utf8Bytes(attempt.output),
          createdAt: attempt.createdAt,
          startedAt: attempt.startedAt ?? null,
          finishedAt: attempt.finishedAt ?? null,
          durationMs: attempt.durationMs ?? null,
          timing: timing(attempt),
          events: attempt.events.map((event) => ({
            kind: event.kind,
            occurredAt: event.occurredAt,
            offsetMs: event.occurredAt - attempt.createdAt,
            detail: diagnosticText(event.detail),
          })),
        }
      : null,
    agentProfile: agent
      ? {
          id: agent.id,
          label: agent.label,
          driver: agent.driver,
          modelId: agent.modelId ?? null,
          extensionId: agent.extensionId ?? null,
          available: agent.available,
          enabled: agent.enabled,
          skillIds: agent.skillIds,
          toolIds: agent.toolIds,
          instructionsCharacters: [...agent.instructions].length,
          instructionsUtf8Bytes: utf8Bytes(agent.instructions),
        }
      : null,
    modelProfile: model
      ? {
          id: model.id,
          label: model.label,
          provider: model.provider,
          remoteId: model.remoteId,
          extensionId: model.extensionId ?? null,
          enabled: model.enabled,
          agentIds: model.agentIds,
          recommended: model.recommended,
        }
      : null,
    runtime: runtime ? { ...runtime, documentUrl: diagnosticUrl(runtime.documentUrl) } : null,
    privacy: {
      secretStoreAccessed: false,
      environmentIncluded: false,
      messageContentIncluded: true,
      urlCredentials: "redacted",
      urlQueryValues: "redacted",
      dataUrls: "metadata-only",
      diagnosticTextLimitBytes: MAX_DIAGNOSTIC_TEXT_BYTES,
    },
  };
}

function diagnosticText(value?: string | null) {
  if (value == null) return null;
  value = redactDiagnosticText(value);
  const bytes = utf8Bytes(value);
  if (bytes <= MAX_DIAGNOSTIC_TEXT_BYTES) return { value, bytes, truncated: false };
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(
    new TextEncoder().encode(value).slice(0, MAX_DIAGNOSTIC_TEXT_BYTES - 3),
  );
  return { value: prefix.replace(/\uFFFD$/, ""), bytes, truncated: true };
}

/** Best-effort transport credential redaction; user-authored content is still
 * included intentionally and is identified as such in the export. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(/Bearer\s+[a-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /((?:"|\b)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1"[redacted]"',
    )
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
      const target = diagnosticUrl(url);
      return target && "sanitized" in target
        ? (target.sanitized ?? "[redacted URL]")
        : "[redacted URL]";
    });
}

export function formatDiagnosticReport(
  report: ReturnType<typeof buildMessageTelemetry> & { executionJournal?: unknown },
) {
  return `Ovule Agent diagnostic v${report.schemaVersion}\nMessage: ${report.message.id}\nAttempt: ${report.execution?.id ?? "none"}\nFindings: ${report.findings.map((item) => item.code).join(", ") || "no automatic classification"}\n\n\`\`\`json\n${JSON.stringify(report, bigintReplacer, 2)}\n\`\`\``;
}

function diagnosticJson(value?: string | null) {
  const text = diagnosticText(value);
  if (!text || text.truncated) return text;
  try {
    return { ...text, parsed: JSON.parse(text.value) };
  } catch {
    return text;
  }
}

function diagnosticUrl(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("data:")) {
    return {
      scheme: "data",
      mediaType: value.slice(5, value.indexOf(";")),
      bytes: value.length,
    };
  }
  try {
    const url = new URL(value);
    const queryKeys = [...url.searchParams.keys()];
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return {
      sanitized: url.href,
      queryKeys,
      hadFragment: new URL(value).hash.length > 0,
    };
  } catch {
    return { sanitized: value, queryKeys: [], hadFragment: false };
  }
}

export function timing(attempt: AttemptView) {
  const created = attempt.createdAt;
  const started = attempt.startedAt;
  const finished = attempt.finishedAt;
  return {
    queueMs: started == null ? null : started - created,
    executionMs: started == null || finished == null ? null : finished - started,
    totalMs: finished == null ? null : finished - created,
  };
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
export function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
