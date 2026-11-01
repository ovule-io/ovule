import { useRef, useState, useLayoutEffect, type PointerEvent } from "react";
import {
  LoaderCircle,
  Workflow,
  X,
  PanelTopOpen,
  GripHorizontal,
  ChevronRight,
  CheckCircle,
  CircleAlert,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Trace, TraceLine, TraceIcon, TraceTitle, TraceDescription } from "@ovule/ui/trace";
import type { AttemptView, GoalView, NodeView, ThreadMessageView } from "@ovule/shell-api";
import { WorkflowGraphCard } from "./WorkflowGraphCard";
import type { WorkflowActivityProps } from "./workflow-presentation";
import styles from "./ConversationPane.module.css";
const active = new Set(["queued", "dispatched", "running", "cancelling"]);

export function WorkflowActivities({
  goal,
  nodes,
  attempts,
  planningAttempts,
  setupThreadId,
  onOpenNode,
  onInspect,
  onResolveGate,
}: WorkflowActivityProps) {
  const { t } = useTranslation();
  const [reviewGate, setReviewGate] = useState<{
    id: string;
    sequence: number;
  }>();
  const activity = workflowActivityFor(goal.id, nodes, attempts, planningAttempts);
  const latest = [...attempts]
    .reverse()
    .find((a) => nodes.some((n) => n.id === a.taskId) && !active.has(a.status));
  const gates = nodes.filter((n) => n.kind === "gate" && n.status === "waiting");
  const failed = nodes.some((n) => ["failed", "blocked", "rejected"].includes(n.status));
  return (
    <Trace data-workflow-activity className={styles.workflowActivity}>
      <strong aria-live="polite">
        {activity.length
          ? t("workflow.backgroundAgents", { count: activity.length })
          : t("workflow.noBackgroundAgents")}
      </strong>
      {activity.map((a) => (
        <button
          className={styles.activityRow}
          key={a.id}
          onClick={() => onOpenNode(a.threadId)}
          title={a.summary}
        >
          <TraceLine
            status={a.status === "queued" || a.status === "dispatched" ? "pending" : "running"}
          >
            <TraceIcon>
              <LoaderCircle size={14} />
            </TraceIcon>
            <span>
              <TraceTitle>
                {nodes.find((n) => n.id === a.taskId)?.title ?? t("workflow.planning")}
              </TraceTitle>
              <TraceDescription>
                {a.agent} · {t(`status.${a.status}`, { defaultValue: a.status })}
              </TraceDescription>
            </span>
          </TraceLine>
          <ChevronRight size={14} />
        </button>
      ))}
      {!activity.length && (
        <small>
          {gates.length
            ? t("workflow.waitingForYou")
            : failed
              ? t("workflow.needsAttention")
              : ["succeeded", "completed"].includes(goal.status)
                ? t("status.succeeded")
                : t("workflow.waitingForDependencies")}
        </small>
      )}
      {gates.map((g) => (
        <button
          className={styles.activityRow}
          data-review-gate
          key={g.id}
          onClick={() =>
            setReviewGate({
              id: g.id,
              sequence: (reviewGate?.sequence ?? 0) + 1,
            })
          }
        >
          <TraceLine status="pending">
            <TraceIcon>
              <ShieldCheck size={14} />
            </TraceIcon>
            <span>
              <TraceTitle>{g.title}</TraceTitle>
              <TraceDescription>{t("workflow.reviewGate")}</TraceDescription>
            </span>
          </TraceLine>
          <ChevronRight size={14} />
        </button>
      ))}
      {latest && !activity.length && (
        <button className={styles.activityRow} onClick={() => onOpenNode(latest.threadId)}>
          <TraceLine status={["failed", "cancelled"].includes(latest.status) ? "error" : undefined}>
            <TraceIcon>
              {["failed", "cancelled"].includes(latest.status) ? (
                <CircleAlert size={14} />
              ) : (
                <CheckCircle size={14} />
              )}
            </TraceIcon>
            <span>
              <TraceTitle>{t("workflow.viewResult")}</TraceTitle>
              <TraceDescription>
                {nodes.find((n) => n.id === latest.taskId)?.title}
              </TraceDescription>
            </span>
          </TraceLine>
          <ChevronRight size={14} />
        </button>
      )}
      {setupThreadId && (
        <button className={styles.activityRow} onClick={() => onOpenNode(setupThreadId)}>
          <span>{t("workflow.openSetup")}</span>
          <ChevronRight size={14} />
        </button>
      )}
      <WorkflowGraphCard
        dialogOnly
        goal={goal}
        nodes={nodes}
        attempts={attempts}
        reviewGate={reviewGate}
        onInspect={onInspect}
        onOpenNode={onOpenNode}
        onResolveGate={onResolveGate}
      />
    </Trace>
  );
}

export function ActiveWorkflowCard(props: WorkflowActivityProps) {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const element = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const [headerBottom, setHeaderBottom] = useState(42);
  useLayoutEffect(() => {
    const parent = element.current?.offsetParent as HTMLElement | null;
    const header = parent?.firstElementChild as HTMLElement | null;
    if (!header) return;
    const update = () => setHeaderBottom(header.offsetTop + header.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, [closed]);
  const start = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button") || e.button !== 0) return;
    const rect = element.current!.getBoundingClientRect();
    const parent = element.current!.offsetParent!.getBoundingClientRect();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: rect.left - parent.left,
      top: rect.top - parent.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current || !element.current) return;
    const parent = element.current.offsetParent as HTMLElement;
    const header = parent.firstElementChild as HTMLElement;
    const top = (header?.offsetTop ?? 0) + (header?.offsetHeight ?? 42) + 16;
    setPosition({
      left: Math.max(
        16,
        Math.min(
          parent.clientWidth - element.current.offsetWidth - 16,
          drag.current.left + e.clientX - drag.current.x,
        ),
      ),
      top: Math.max(
        top,
        Math.min(
          parent.clientHeight - element.current.offsetHeight - 16,
          drag.current.top + e.clientY - drag.current.y,
        ),
      ),
    });
  };
  if (closed)
    return (
      <aside
        ref={element}
        className={styles.activityRestore}
        style={
          position
            ? { left: position.left, top: position.top, right: "auto" }
            : { top: headerBottom + 16 }
        }
      >
        <button aria-label={t("workflow.activities")} onClick={() => setClosed(false)}>
          <Workflow size={14} />
          {t("workflow.activities")}
        </button>
      </aside>
    );
  return (
    <aside
      ref={element}
      data-active-workflow={props.goal.id}
      className={styles.activeWorkflow}
      style={
        position
          ? { left: position.left, top: position.top, right: "auto" }
          : { top: headerBottom + 16 }
      }
      aria-label={props.goal.title}
    >
      <header
        className={styles.activityHeader}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        <GripHorizontal size={14} />
        <span title={props.goal.title}>{props.goal.title}</span>
        <button
          title={t("workflow.open")}
          aria-label={t("workflow.open")}
          onClick={props.onInspect}
        >
          <PanelTopOpen size={14} />
        </button>
        <button
          title={closed ? t("workflow.activities") : t("conversation.cancel")}
          aria-label={closed ? t("workflow.activities") : t("conversation.cancel")}
          onClick={() => setClosed(!closed)}
        >
          {closed ? <Workflow size={14} /> : <X size={14} />}
        </button>
      </header>
      {!closed && (
        <>
          <small className={styles.activityProgress}>{props.goal.progress}</small>
          <WorkflowActivities {...props} />
        </>
      )}
    </aside>
  );
}

export function workflowSetupThread(
  goalId: string,
  nodes: NodeView[],
  messages: ThreadMessageView[],
): string | undefined {
  for (const message of messages)
    for (const part of message.parts) {
      if (part.kind !== "workflow" || !part.dataJson) continue;
      try {
        const data = JSON.parse(part.dataJson);
        if (data.goalId !== goalId || typeof data.setupNodeId !== "string") continue;
        return (
          nodes.find((node) => node.goalId === goalId && node.id === data.setupNodeId)?.threadId ||
          undefined
        );
      } catch {
        /* Old or malformed Message Parts never break navigation. */
      }
    }
}

export function workflowActivityFor(
  goalId: string,
  nodes: NodeView[],
  attempts: AttemptView[],
  planningAttempts: AttemptView[],
): AttemptView[] {
  const nodeIds = new Set(nodes.filter((node) => node.goalId === goalId).map((node) => node.id));
  return [
    ...planningAttempts.filter(
      (attempt) =>
        active.has(attempt.status) &&
        (attempt.purpose === `goal_adjustment:${goalId}` ||
          attempt.purpose.startsWith(`workflow_replan:${goalId}:`)),
    ),
    ...attempts.filter(
      (attempt) => attempt.taskId && nodeIds.has(attempt.taskId) && active.has(attempt.status),
    ),
  ];
}
