import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AttemptView, ExecutionCallView } from "@ovule/shell-api";
import { harnessTelemetry } from "./harness-telemetry";
export type ExecutionJournalSnapshot = {
  attemptId: string;
  eventCount: number;
  rows: ExecutionCallView[];
  failed: boolean;
};
export function HarnessTelemetry({
  attempt,
  onJournalChange,
}: {
  attempt?: AttemptView;
  onJournalChange?(snapshot: ExecutionJournalSnapshot): void;
}) {
  const { t } = useTranslation();
  const [journal, setJournal] = useState<ExecutionJournalSnapshot>();
  useEffect(() => {
    if (!attempt?.id) return;
    let active = true;
    void import("@ovule/shell-api")
      .then((api) => api.agent.executionCalls(attempt.id))
      .then((rows) => {
        if (active) {
          const snapshot = {
            attemptId: attempt.id,
            eventCount: attempt.events.length,
            rows,
            failed: false,
          };
          setJournal(snapshot);
          onJournalChange?.(snapshot);
        }
      })
      .catch(() => {
        if (active) {
          const snapshot = {
            attemptId: attempt.id,
            eventCount: attempt.events.length,
            rows: [],
            failed: true,
          };
          setJournal(snapshot);
          onJournalChange?.(snapshot);
        }
      });
    return () => {
      active = false;
    };
  }, [attempt?.id, attempt?.events.length, onJournalChange]);
  const records = journal?.attemptId === attempt?.id ? journal : undefined;
  const data = harnessTelemetry(attempt?.events ?? []);
  if (
    !data.version &&
    !data.warnings.length &&
    !data.execution.length &&
    !data.approvals.length &&
    !records?.rows.length &&
    !records?.failed
  )
    return <p className="text-(--muted-foreground)">{t("conversation.harnessNoTrace")}</p>;
  return (
    <section className="grid gap-3" data-harness-telemetry>
      <h3 className="font-semibold">{t("conversation.harnessAssembly")}</h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt>Harness</dt>
        <dd>{data.version ?? "—"}</dd>
        <dt>{t("conversation.harnessRoute")}</dt>
        <dd>{data.route ?? "—"}</dd>
        <dt>{t("conversation.harnessContext")}</dt>
        <dd>
          {data.contextUsed.toLocaleString()} / {data.contextBudget.toLocaleString()}
        </dd>
        <dt>{t("conversation.harnessCalls")}</dt>
        <dd>
          {data.totalCalls} · {data.failures} {t("conversation.harnessFailures")} ·{" "}
          {data.toolDurationMs} ms
        </dd>
        <dt>Skills</dt>
        <dd>{data.skills.map((skill) => skill.name).join(", ") || "—"}</dd>
        <dt>Memory scopes</dt>
        <dd className="break-all">{data.memoryScopes.join(", ") || "—"}</dd>
      </dl>
      {data.warnings.map((warning, index) => (
        <p key={index} role="status" className="text-(--muted-foreground)">
          {warning}
        </p>
      ))}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="text-left font-medium">
            {t("conversation.harnessCapabilities")}
          </caption>
          <thead>
            <tr>
              <th>Capability</th>
              <th>Projection</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.bindings.map((binding) => (
              <tr key={binding.id}>
                <td>{binding.id}</td>
                <td>{binding.projection}</td>
                <td title={binding.reason}>
                  {binding.available ? t("conversation.harnessAvailable") : binding.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.tools.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="text-left font-medium">
              {t("conversation.harnessToolSummary")}
            </caption>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Calls</th>
                <th>Failed</th>
                <th>ms</th>
                <th>In / out bytes</th>
              </tr>
            </thead>
            <tbody>
              {data.tools.map((tool) => (
                <tr key={tool.tool}>
                  <td>{tool.tool}</td>
                  <td>{tool.calls}</td>
                  <td>{tool.failures}</td>
                  <td>{tool.durationMs}</td>
                  <td>
                    {tool.inputBytes} / {tool.outputBytes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(data.execution.length > 0 || data.approvals.length > 0) && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="text-left font-medium">
              {t("conversation.harnessExecution")}
            </caption>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Status</th>
                <th>ms</th>
                <th>Call ID</th>
              </tr>
            </thead>
            <tbody>
              {data.approvals.map((entry, index) => (
                <tr key={`approval-${index}`}>
                  <td>{entry.tool}</td>
                  <td>
                    {t("conversation.harnessApproval")}: {entry.status}
                  </td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              ))}
              {data.execution.map((entry, index) => (
                <tr key={`execution-${index}`}>
                  <td>{entry.tool}</td>
                  <td>
                    {entry.status}
                    {entry.failureKind ? ` · ${entry.failureKind}` : ""}
                  </td>
                  <td>{entry.durationMs}</td>
                  <td className="break-all font-mono">{entry.callId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {records?.failed && <p role="status">{t("conversation.harnessJournalUnavailable")}</p>}
      {Boolean(records?.rows.length) && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-execution-journal>
            <caption className="text-left font-medium">{t("conversation.harnessJournal")}</caption>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Status</th>
                <th>Call ID</th>
              </tr>
            </thead>
            <tbody>
              {records!.rows.map((record) => (
                <tr key={record.callId}>
                  <td>{record.tool}</td>
                  <td>
                    {["dispatched", "uncertain"].includes(record.state)
                      ? t("conversation.harnessUnsettled")
                      : record.state}
                  </td>
                  <td className="break-all font-mono">{record.callId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.retainedTimeline && <p>{t("conversation.harnessRetained")}</p>}
      {data.invalidEvents > 0 && (
        <p>{t("conversation.harnessInvalid", { count: data.invalidEvents })}</p>
      )}
      <p className="text-xs text-(--muted-foreground)">{t("conversation.harnessPrivacy")}</p>
    </section>
  );
}
