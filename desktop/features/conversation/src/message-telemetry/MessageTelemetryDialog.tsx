import {
  buildMessageTelemetry,
  bigintReplacer,
  utf8Bytes,
  formatDiagnosticReport,
  timing,
} from "./diagnostic-report";
import { HarnessTelemetry, type ExecutionJournalSnapshot } from "./HarnessTelemetry";
import { parseHarnessEvent } from "./harness-telemetry";
import shellTokens from "@ovule/shell/shell.token";
import { useService } from "@ovule/ioc/react";
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ovule/ui/dialog";

import type {
  AgentView,
  AttemptView,
  ModelView,
  ThreadMessageView,
  ThreadView,
} from "@ovule/shell-api";
import styles from "./MessageTelemetryDialog.module.css";

const telemetrySectionClass = `${styles.section} mt-[18px]`;

export { captureMessageTelemetryRuntime } from "./runtime";
export type { MessageTelemetryRuntime } from "./runtime";
import { captureMessageTelemetryRuntime, type MessageTelemetryRuntime } from "./runtime";

export function MessageTelemetryDialog({
  message,
  attempt,
  thread,
  agent,
  model,
  snapshotRevision,
  runtime,
  onOpenChange,
  contextMessages,
}: {
  contextMessages?: ThreadMessageView[];
  message?: ThreadMessageView;
  attempt?: AttemptView;
  thread?: ThreadView;
  agent?: AgentView;
  model?: ModelView;
  snapshotRevision: bigint;
  runtime?: MessageTelemetryRuntime;
  onOpenChange(open: boolean): void;
}) {
  const { copyText } = useService(shellTokens.shell);

  const i18n = useTranslation().i18n;

  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [executionJournal, setExecutionJournal] = useState<ExecutionJournalSnapshot>();
  const telemetry = useMemo(
    () =>
      message
        ? {
            ...buildMessageTelemetry({
              message,
              contextMessages,
              attempt,
              thread,
              agent,
              model,
              snapshotRevision,
              runtime: runtime ?? captureMessageTelemetryRuntime(),
            }),
            executionJournal: !attempt
              ? { status: "not_applicable", records: [] }
              : executionJournal?.attemptId === attempt.id &&
                  executionJournal.eventCount === attempt.events.length
                ? {
                    status: executionJournal.failed ? "unavailable" : "ready",
                    records: executionJournal.rows,
                  }
                : { status: "loading", records: [] },
          }
        : undefined,
    [
      agent,
      attempt,
      message,
      model,
      runtime,
      snapshotRevision,
      thread,
      executionJournal,
      contextMessages,
    ],
  );
  const json = useMemo(() => JSON.stringify(telemetry, bigintReplacer, 2), [telemetry]);
  const copy = async () => {
    if (!telemetry || copying) return;
    setCopying(true);
    setCopyError(false);
    try {
      let journal = telemetry.executionJournal;
      if (attempt && journal.status !== "ready") {
        try {
          const api = await import("@ovule/shell-api");
          journal = { status: "ready", records: await api.agent.executionCalls(attempt.id) };
        } catch {
          journal = { status: "unavailable", records: [] };
        }
      }
      const success = await copyText(
        formatDiagnosticReport({ ...telemetry, executionJournal: journal }),
      );
      setCopied(success);
      setCopyError(!success);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopyError(true);
    } finally {
      setCopying(false);
    }
  };

  return (
    <Dialog open={Boolean(message)} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(820px,calc(100vh-36px))] max-h-[calc(100vh-36px)] w-[min(920px,calc(100vw-36px))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("conversation.telemetryTitle")}</DialogTitle>
          <DialogDescription>{t("conversation.telemetryDescription")}</DialogDescription>
        </DialogHeader>
        {message && telemetry && (
          <div className="mt-[18px] min-h-0 overflow-auto pr-1">
            {telemetry.findings.length > 0 && (
              <section className="mb-3 rounded-lg bg-(--surface-3) p-3" data-diagnostic-findings>
                {telemetry.findings.map((finding, index) => (
                  <p key={index} className="my-1 text-sm">
                    <strong>{finding.code}</strong> · {finding.evidence}
                  </p>
                ))}
              </section>
            )}
            <section
              className="grid grid-cols-3 gap-2 max-sm:grid-cols-1"
              aria-label={t("conversation.telemetrySummary")}
            >
              <TelemetryMetric label={i18n.t("messageTelemetry.role")} value={message.role} />
              <TelemetryMetric label={i18n.t("messageTelemetry.status")} value={message.status} />
              <TelemetryMetric
                label={i18n.t("messageTelemetry.streamSequence")}
                value={message.streamSequence.toString()}
              />
              <TelemetryMetric
                label={i18n.t("messageTelemetry.parts")}
                value={String(message.parts.length)}
              />
              <TelemetryMetric
                label={i18n.t("messageTelemetry.characters")}
                value={String([...message.content].length)}
              />
              <TelemetryMetric
                label={i18n.t("messageTelemetry.uTF8Bytes")}
                value={String(utf8Bytes(message.content))}
              />
            </section>

            <section className={telemetrySectionClass}>
              <HarnessTelemetry attempt={attempt} onJournalChange={setExecutionJournal} />
            </section>

            <section className={telemetrySectionClass}>
              <h3 className={styles.sectionTitle}>{t("conversation.telemetryCorrelation")}</h3>
              <TelemetryRows
                rows={[
                  ["message.id", message.id],
                  ["message.threadId", message.threadId],
                  ["message.attemptId", message.attemptId],
                  ["thread.title", thread?.title],
                  ["thread.workspacePath", thread?.workspacePath],
                  ["snapshot.revision", snapshotRevision.toString()],
                  ["created.local", formatLocal(message.createdAt)],
                  ["created.iso", new Date(message.createdAt).toISOString()],
                  ["created.epochMs", String(message.createdAt)],
                ]}
              />
            </section>

            <section className={telemetrySectionClass}>
              <h3 className={styles.sectionTitle}>{t("conversation.telemetryExecution")}</h3>
              {attempt ? (
                <>
                  <TelemetryRows
                    rows={[
                      ["attempt.id", attempt.id],
                      ["attempt.purpose", attempt.purpose],
                      ["attempt.taskId", attempt.taskId],
                      ["attempt.status", attempt.status],
                      ["host.id", attempt.hostId],
                      ["agent.id", attempt.agent],
                      ["agent.label", agent?.label],
                      ["driver", attempt.driver ?? agent?.driver],
                      ["model.id", model?.id ?? thread?.modelId],
                      ["model.provider", attempt.modelProvider ?? model?.provider],
                      ["model.remoteId", attempt.modelRemoteId ?? model?.remoteId],
                      ["output.sequence", attempt.outputSequence.toString()],
                      ["queue.ms", timing(attempt).queueMs],
                      ["execution.ms", timing(attempt).executionMs],
                      ["total.ms", timing(attempt).totalMs],
                    ]}
                  />
                  <ol
                    className="mt-2.5 grid list-none gap-2 p-0"
                    aria-label={t("conversation.telemetryEvents")}
                  >
                    {attempt.events.map((event, index) => (
                      <li
                        className="grid grid-cols-[82px_minmax(0,1fr)] gap-2.5 border-l-2 border-(--border) bg-(--surface-2) px-2.5 py-[9px] max-sm:grid-cols-1"
                        key={`${event.kind}-${event.occurredAt}-${index}`}
                      >
                        <span className="text-(--faint) [font:var(--font-size-caption)_/_1.5_var(--font-mono)]">
                          {formatOffset(event.occurredAt - attempt.createdAt)}
                        </span>
                        <div>
                          <strong>{event.kind}</strong>
                          <small className="block text-(--faint) [font:var(--font-size-caption)_/_1.5_var(--font-mono)]">
                            {new Date(event.occurredAt).toISOString()}
                          </small>
                          <p className="mt-1 mb-0 text-(length:--font-size-ui) text-(--muted-foreground)">
                            {describeEvent(event)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="text-(length:--font-size-ui) text-(--faint)">
                  {t("conversation.telemetryNoAttempt")}
                </p>
              )}
            </section>

            <section className={telemetrySectionClass}>
              <h3 className={styles.sectionTitle}>{t("conversation.telemetryParts")}</h3>
              <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                {message.parts.map((part, index) => (
                  <div
                    className={`${styles.part} min-w-0 rounded-lg border border-(--line) bg-(--surface-2) px-2.5 py-[9px]`}
                    key={part.id}
                  >
                    <strong className={`${styles.partLine} ${styles.partTitle}`}>
                      #{index + 1} · {part.kind}
                    </strong>
                    <span className={`${styles.partLine} ${styles.partDetail}`}>
                      {part.mediaType ?? "—"}
                    </span>
                    <small className={`${styles.partLine} ${styles.partDetail}`}>{part.id}</small>
                    <small className={`${styles.partLine} ${styles.partDetail}`}>
                      {part.sizeBytes !== undefined
                        ? formatBytes(Number(part.sizeBytes))
                        : `${utf8Bytes(part.text ?? part.dataJson ?? "")} B encoded`}
                    </small>
                  </div>
                ))}
              </div>
            </section>

            <section className={telemetrySectionClass}>
              <div className="flex items-center justify-between">
                <h3 className={styles.sectionTitle}>{t("conversation.telemetryRaw")}</h3>
              </div>
              <pre
                data-message-telemetry-json
                className="m-0 max-h-[360px] overflow-auto rounded-[9px] border border-(--line) bg-(--surface-3) p-3 whitespace-pre-wrap text-(--muted-foreground) [overflow-wrap:anywhere] [font:var(--font-size-caption)_/_1.55_var(--font-mono)]"
              >
                {json}
              </pre>
            </section>
          </div>
        )}
        <DialogFooter>
          {copyError && <span role="status">{t("conversation.telemetryCopyFailed")}</span>}
          <Button
            size="sm"
            variant="secondary"
            disabled={!telemetry || copying}
            aria-busy={copying}
            onClick={() => void copy()}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {t(copied ? "conversation.telemetryCopied" : "conversation.telemetryCopy")}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.closeDialog")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TelemetryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-(--line) bg-(--surface-2) p-2.5">
      <span className="block text-(length:--font-size-caption) text-(--faint)">{label}</span>
      <strong className="mt-1 block overflow-hidden text-ellipsis [font:500_var(--font-size-caption)_/_1.4_var(--font-mono)]">
        {value}
      </strong>
    </div>
  );
}

function TelemetryRows({ rows }: { rows: Array<[string, string | number | null | undefined]> }) {
  return (
    <dl className="m-0 overflow-hidden rounded-[9px] border border-(--line)">
      {rows.map(([label, value]) => (
        <div
          className="grid grid-cols-[minmax(130px,0.32fr)_minmax(0,1fr)] border-t border-(--line) first:border-t-0 max-sm:grid-cols-1"
          key={label}
        >
          <dt className="m-0 min-w-0 bg-(--surface-2) px-[9px] py-[7px] text-(--faint) [overflow-wrap:anywhere] [font:var(--font-size-caption)_/_1.5_var(--font-mono)]">
            {label}
          </dt>
          <dd className="m-0 min-w-0 px-[9px] py-[7px] [overflow-wrap:anywhere] [font:var(--font-size-caption)_/_1.5_var(--font-mono)]">
            {value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatLocal(date: number): string {
  return `${new Date(date).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}

function formatOffset(milliseconds: number): string {
  return `+${milliseconds.toLocaleString()} ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function describeEvent(event: { kind: string; detail: string }) {
  const value = parseHarnessEvent(event);
  if (value && event.kind === "harness/model_round") {
    return `Model round ${value.round} · finish ${JSON.stringify(value.finish_reason)} · text ${value.text_bytes} B · reasoning ${value.reasoning_bytes} B${value.finalizing ? " · finalizing" : ""}`;
  }
  if (value && event.kind === "harness/acp_completion") {
    return `ACP ${value.stop_reason} · text ${value.text_bytes} B · empty answer ${value.empty_answer}`;
  }
  return value
    ? `${String(value.tool ?? value.harness_version ?? "Harness")} · ${String(value.operation ?? value.route ?? "")} · ${String(value.status ?? "assembled")}`
    : event.detail.slice(0, 2048);
}
