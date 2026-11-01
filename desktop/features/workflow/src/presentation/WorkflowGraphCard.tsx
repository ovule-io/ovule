import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@ovule/ui/dialog";
import { Button } from "@ovule/ui/button";
import { TraceLine, TraceIcon, TraceTitle, TraceDescription } from "@ovule/ui/trace";
import {
  Bot,
  Check,
  Circle,
  GitBranch,
  LoaderCircle,
  PanelTopOpen,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@ovule/ui/cn";
import type { AttemptView, GoalView, NodeView } from "@ovule/shell-api";
import styles from "./WorkflowGraphCard.module.css";
import { LarkGate } from "./LarkGate";
import { larkGateKind } from "./lark-gate";
import { workflowColumns } from "./workflow-layout";

export type WorkflowGraphProps = {
  dialogOnly?: boolean;
  flat?: boolean;
  reviewGate?: { id: string; sequence: number };
  goal: GoalView;
  nodes: NodeView[];
  attempts: AttemptView[];
  onInspect?(): void;
  onOpenNode(threadId: string): void;
  onResolveGate?(nodeId: string, approved: boolean): Promise<boolean>;
};

export function WorkflowGraphCard({
  goal,
  nodes,
  attempts,
  onInspect,
  onOpenNode,
  onResolveGate,
  reviewGate,
  dialogOnly = false,
  flat = false,
}: WorkflowGraphProps) {
  const { t } = useTranslation();
  const [selectedGateId, setSelectedGateId] = useState<string>();
  useEffect(() => {
    if (reviewGate) setSelectedGateId(reviewGate.id);
  }, [reviewGate]);
  const [resolving, setResolving] = useState(false);
  const [gateError, setGateError] = useState<string>();
  const selectedGate = nodes.find((node) => node.id === selectedGateId);
  const guidedGate = selectedGate && larkGateKind(goal, selectedGate);
  const resolveGate = async (approved: boolean) => {
    if (!selectedGate || !onResolveGate || resolving) return;
    setResolving(true);
    setGateError(undefined);
    try {
      if (await onResolveGate(selectedGate.id, approved)) setSelectedGateId(undefined);
      else setGateError(t("workflow.gateFailed"));
    } catch (error) {
      setGateError(error instanceof Error ? error.message : String(error));
    } finally {
      setResolving(false);
    }
  };
  const visibleNodes = nodes.filter((node) => node.status !== "superseded");
  const columns = workflowColumns(visibleNodes);
  const active = [...attempts]
    .reverse()
    .find((attempt) => ["queued", "dispatched", "running", "cancelling"].includes(attempt.status));
  return (
    <section
      className={
        dialogOnly
          ? undefined
          : cn("goal-card", flat ? styles.flatWorkflow : styles.threadWorkflowCard)
      }
      data-goal-status={goal.status}
      onClick={(event) => {
        if (event.currentTarget.contains(event.target as globalThis.Node)) onInspect?.();
      }}
    >
      {!dialogOnly && (
        <>
          {!flat && (
            <header className={styles.threadWorkflowHeader}>
              <div>
                <span className={"eyebrow"}>
                  {t("conversation.goal")} · {t("workflow.liveGraph")}
                </span>
                <h2 className={styles.threadWorkflowTitle}>{goal.title}</h2>
              </div>
              <div className={styles.workflowHeaderActions}>
                <span className={cn(styles.workflowState, styles[goal.status])}>
                  <span className={cn(styles.workflowStateDot, styles[goal.status])} />
                  {t(`status.${goal.status}`, { defaultValue: goal.status })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("workflow.open")}
                  title={t("workflow.open")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onInspect?.();
                  }}
                >
                  <PanelTopOpen size={14} />
                </Button>
              </div>
            </header>
          )}
          <p className={styles.threadGoalIntent}>{goal.intent}</p>
          <div className={styles.workflowGraphShell}>
            <div
              className={styles.workflowGraph}
              role="list"
              aria-label={t("workflow.graphLabel", { title: goal.title })}
            >
              <div className={styles.workflowOrigin} title={t("conversation.goal")}>
                <GitBranch size={14} />
              </div>
              {columns.length ? (
                columns.map((column, columnIndex) => (
                  <div
                    className={cn(styles.workflowLevel, column.length > 1 && styles.parallel)}
                    data-workflow-level={columnIndex}
                    key={`level:${columnIndex}`}
                  >
                    <span className={styles.workflowLevelConnector} aria-hidden />
                    <div className={styles.workflowBranchStack}>
                      {column.map((node) => {
                        return (
                          <div className={styles.workflowBranch} role="listitem" key={node.id}>
                            <Button
                              data-workflow-node={node.id}
                              variant="ghost"
                              size="sm"
                              className={cn(
                                styles.workflowGraphNode,
                                styles[node.kind],
                                styles[node.status],
                              )}
                              title={`${t(`nodeKind.${node.kind}`, { defaultValue: node.kind })}: ${node.title} · ${t(`status.${node.status}`, { defaultValue: node.status })}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (node.kind === "gate") {
                                  setGateError(undefined);
                                  setSelectedGateId(node.id);
                                } else if (node.threadId) onOpenNode(node.threadId);
                                else onInspect?.();
                              }}
                            >
                              <span
                                className={cn(
                                  styles.workflowNodeIcon,
                                  styles[node.kind],
                                  styles[node.status],
                                )}
                              >
                                {node.kind === "gate" ? (
                                  <ShieldCheck size={12} />
                                ) : node.status === "succeeded" ? (
                                  <Check size={12} />
                                ) : ["running", "dispatched", "queued"].includes(node.status) ? (
                                  <LoaderCircle className={"spin"} size={12} />
                                ) : (
                                  <Circle size={12} />
                                )}
                              </span>
                              <span className={styles.workflowNodeBody}>
                                <strong
                                  className={cn(styles.workflowNodeLine, styles.workflowNodeTitle)}
                                >
                                  {node.title}
                                </strong>
                                <small
                                  className={cn(styles.workflowNodeLine, styles.workflowNodeDetail)}
                                >
                                  {t(`nodeKind.${node.kind}`, {
                                    defaultValue: node.kind,
                                  })}
                                  {node.agent ? ` · ${node.agent}` : ""}
                                </small>
                              </span>
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className={styles.workflowEmptyGraph}>
                  <span className={styles.workflowEdge} />
                  <span>{t("workflow.empty")}</span>
                </div>
              )}
            </div>
          </div>
          <footer className={styles.threadWorkflowFooter}>
            <div className={styles.progressTrack}>
              <span
                className={styles.progressValue}
                data-workflow-progress
                style={{
                  width: `${Math.max(4, visibleNodes.length ? (visibleNodes.filter((node) => ["succeeded", "approved"].includes(node.status)).length / visibleNodes.length) * 100 : 0)}%`,
                }}
              />
            </div>
            <small className={styles.workflowProgress}>{goal.progress}</small>
          </footer>
          {active && (
            <div
              className={styles.workflowLiveAttempt}
              data-testid="workflow-live-attempt"
              data-output-sequence={active.outputSequence.toString()}
            >
              <TraceLine
                status={
                  active.status === "queued" || active.status === "dispatched"
                    ? "pending"
                    : "running"
                }
                className={styles.workflowLiveHeader}
              >
                <TraceIcon>
                  <Bot size={14} />
                </TraceIcon>
                <TraceTitle className={styles.workflowLiveAgent}>{active.agent}</TraceTitle>
                <TraceDescription className={styles.workflowLiveSummary}>
                  {active.summary}
                </TraceDescription>
              </TraceLine>
            </div>
          )}
        </>
      )}
      <Dialog
        open={Boolean(selectedGate)}
        onOpenChange={(open) => {
          if (!open) setSelectedGateId(undefined);
        }}
      >
        <DialogContent
          onClick={(event) => event.stopPropagation()}
          closeLabel={t("conversation.cancel")}
        >
          <DialogTitle>{selectedGate?.title}</DialogTitle>
          <DialogDescription>
            {guidedGate
              ? t("workflow.larkAutoVerify")
              : selectedGate?.status === "waiting"
                ? t("workflow.gateReady")
                : t("workflow.gateUnavailable")}
          </DialogDescription>
          <p>
            {t("workflow.currentGateStatus")}{" "}
            {t(`status.${selectedGate?.status}`, {
              defaultValue: selectedGate?.status ?? "",
            })}
          </p>
          {selectedGate?.dependencyIds.length ? (
            <ul
              aria-label={t("workflow.prerequisites")}
              className="space-y-2 text-(length:--font-size-ui)"
            >
              <li className="text-(--muted-foreground)">{t("workflow.prerequisites")}</li>
              {selectedGate.dependencyIds.map((id) => {
                const dependency = nodes.find((node) => node.id === id);
                return (
                  <li key={id}>
                    {dependency?.title ?? id} ·{" "}
                    {t(`status.${dependency?.status}`, {
                      defaultValue: dependency?.status ?? "",
                    })}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {guidedGate && selectedGate && (
            <LarkGate
              key={selectedGate.id}
              kind={guidedGate}
              threadId={goal.threadId}
              waiting={selectedGate.status === "waiting"}
              resolving={resolving}
              onReject={
                onResolveGate
                  ? async () => {
                      if (!(await onResolveGate(selectedGate.id, false)))
                        throw new Error(t("workflow.gateFailed"));
                      setSelectedGateId(undefined);
                    }
                  : undefined
              }
              onVerified={async () => {
                if (!onResolveGate || resolving) return;
                setResolving(true);
                try {
                  if (!(await onResolveGate(selectedGate.id, true)))
                    throw new Error(t("workflow.gateFailed"));
                  setSelectedGateId(undefined);
                } finally {
                  setResolving(false);
                }
              }}
            />
          )}
          {gateError && (
            <p role="alert" className="text-(--danger)">
              {gateError}
            </p>
          )}
          {selectedGate?.status === "waiting" && onResolveGate && !guidedGate && (
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={resolving}
                onClick={() => void resolveGate(false)}
              >
                {t("workflow.reject")}
              </Button>
              {!guidedGate && (
                <Button disabled={resolving} onClick={() => void resolveGate(true)}>
                  {t("workflow.approve")}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
