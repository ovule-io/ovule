import { Children, type ReactNode } from "react";
import { Check, LoaderCircle, Wrench, CircleAlert, CircleMinus, CircleStop } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
} from "./trace";
import styles from "./tool.module.css";
export type ToolState = "pending" | "running" | "completed" | "failed" | "error" | "cancelled";
/** A Tool is a Trace line with optional expandable input/output. */
export function Tool({
  title,
  state,
  label,
  description,
  children,
}: {
  title: string;
  state: ToolState;
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  const Icon =
    state === "running"
      ? LoaderCircle
      : state === "completed"
        ? Check
        : state === "error"
          ? CircleAlert
          : state === "failed"
            ? CircleMinus
            : state === "cancelled"
              ? CircleStop
              : Wrench;
  const line = (
    <TraceLine status={state === "running" ? "running" : undefined}>
      <TraceIcon>
        <Icon />
      </TraceIcon>
      <TraceTitle>{title}</TraceTitle>
      <span className={styles.badge}>{label}</span>
      {description && <TraceDescription>{description}</TraceDescription>}
    </TraceLine>
  );
  return (
    <div className={styles.tool} data-slot="tool" data-state={state}>
      <Trace>
        {Children.toArray(children).length ? (
          <TraceCollapsible defaultOpen={false}>
            <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
            <TraceCollapsibleContent keepMounted>{children}</TraceCollapsibleContent>
          </TraceCollapsible>
        ) : (
          line
        )}
      </Trace>
    </div>
  );
}
