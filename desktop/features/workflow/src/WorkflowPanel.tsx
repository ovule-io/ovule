import { useState } from "react";
import type { WorkflowPresentation } from "@ovule/workflow/presentation/workflow-presentation";
import type { ViewData } from "./view-data";
import { Check, ChevronRight, Circle, GitBranch, MessageSquare, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import type { WorkspaceOperation } from "./operations";
import type { GoalView, NodeView } from "@ovule/shell-api";

export function WorkflowPanel({
  nodes,
  goal,
  invoke,
  busy,
  openNodeThread,
  snapshot,
  presentation,
}: {
  presentation: WorkflowPresentation;
  nodes: NodeView[];
  goal?: GoalView;
  invoke(operation: WorkspaceOperation): Promise<boolean>;
  busy: boolean;
  openNodeThread(threadId: string): void;
  snapshot: ViewData;
}) {
  const [reviewGate, setReviewGate] = useState<{ id: string; sequence: number }>();
  const i18n = useTranslation().i18n;

  const { t } = useTranslation();
  return (
    <div className="workflow-panel h-full min-h-0 overflow-y-auto p-4" data-workflow-panel>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <span>{t("workflow.liveGraph")}</span>
          <h3 className="mt-1 mb-0 line-clamp-2 overflow-hidden text-(length:--font-size-title) font-semibold [overflow-wrap:anywhere]">
            {goal?.title ?? t("workflow.nodes")}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {goal && (
            <Button variant="ghost" size="sm" onClick={() => openNodeThread(goal.threadId)}>
              <MessageSquare size={14} /> {i18n.t("conversation.thread")}{" "}
            </Button>
          )}
          <GitBranch size={18} />
        </div>
      </div>
      {goal && (
        <div className="workflow-overview">
          <presentation.Graph
            flat
            reviewGate={reviewGate}
            goal={goal}
            nodes={nodes}
            attempts={snapshot.attempts}
            onOpenNode={openNodeThread}
            onInspect={() => {}}
            onResolveGate={(id, approved) => invoke((api) => api.resolveGate(id, approved))}
          />
          <section aria-label={t("workflow.activities")}>
            <h4>{t("workflow.activities")}</h4>
            <presentation.Activities
              goal={goal}
              nodes={nodes}
              attempts={snapshot.attempts}
              planningAttempts={snapshot.attempts}
              onOpenNode={openNodeThread}
              onInspect={() => {}}
              onResolveGate={(id, approved) => invoke((api) => api.resolveGate(id, approved))}
            />
          </section>
        </div>
      )}
      <details className="mt-4">
        <summary>{t("workflow.nodes")}</summary>
        <div>
          {nodes.length ? (
            nodes.map((node, index) => (
              <article
                className={cn(
                  "grid min-h-16 grid-cols-[21px_minmax(0,1fr)] gap-2",
                  node.status === "superseded" && "opacity-55",
                )}
                key={node.id}
              >
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full border border-(--line-strong) bg-(--surface) text-(--muted-foreground)",
                      ["succeeded", "approved"].includes(node.status) &&
                        "border-(--success) bg-(--success-soft) text-(--success)",
                      node.kind === "gate" &&
                        node.status === "waiting" &&
                        "border-(--warning) bg-(--warning-soft) text-(--warning)",
                    )}
                  >
                    {node.status === "succeeded" ? (
                      <Check size={12} />
                    ) : node.kind === "gate" ? (
                      <ShieldCheck size={12} />
                    ) : (
                      <Circle size={12} />
                    )}
                  </span>
                  {index < nodes.length - 1 && <i className="w-px flex-1 bg-(--line)" />}
                </div>
                <div
                  className="min-w-0 cursor-pointer overflow-hidden pb-3"
                  role="button"
                  tabIndex={0}
                  onClick={() => node.threadId && openNodeThread(node.threadId)}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && node.threadId) {
                      openNodeThread(node.threadId);
                    }
                  }}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-(--faint) text-(length:--font-size-caption)">
                      {t(`nodeKind.${node.kind}`, { defaultValue: node.kind })}
                    </span>
                    <small className="text-(--faint) text-(length:--font-size-caption)">
                      {t(`status.${node.status}`, {
                        defaultValue: node.status,
                      })}
                    </small>
                  </div>
                  <strong className="mt-1 mb-1 line-clamp-2 block overflow-hidden text-(length:--font-size-ui) font-medium [overflow-wrap:anywhere]">
                    {node.title}
                  </strong>
                  {node.agent && (
                    <em className="mb-2 block text-(length:--font-size-ui) text-(--faint) not-italic">
                      {t("workflow.agent", { name: node.agent })}
                    </em>
                  )}
                  <small className="mb-2 block text-(length:--font-size-caption) text-(--faint)">
                    {snapshot.hosts.find((host) => host.id === node.hostId)?.displayName ??
                      node.hostId}
                    {node.workspaceBindingIds.length
                      ? ` · ${node.workspaceBindingIds
                          .map(
                            (id) =>
                              snapshot.bindings.find((binding) => binding.id === id)?.alias ?? id,
                          )
                          .join(", ")}`
                      : ""}
                  </small>
                  {node.kind === "task" &&
                    ["pending", "failed", "cancelled", "blocked"].includes(node.status) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void invoke((api) => api.delegateTask(node.id));
                        }}
                      >
                        <ChevronRight size={12} />
                        {node.status === "pending" ? t("workflow.delegate") : t("workflow.retry")}
                      </Button>
                    )}
                  {node.kind === "gate" && node.status === "waiting" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        setReviewGate({ id: node.id, sequence: Date.now() });
                      }}
                    >
                      {t("workflow.larkReview")}
                    </Button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="flex min-h-45 items-center justify-center gap-2 text-(length:--font-size-ui) text-(--faint)">
              {t("workflow.empty")}
            </div>
          )}
        </div>
      </details>
      {goal && (
        <div className="mt-1.5 rounded-[9px] border border-(--line) bg-(--surface) p-3 text-(length:--font-size-caption) text-(--faint)">
          {t("workflow.adjustHint", { goalId: goal.id })}
        </div>
      )}
    </div>
  );
}
