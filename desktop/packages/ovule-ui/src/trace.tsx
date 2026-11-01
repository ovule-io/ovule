import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./overlays";
import { cn } from "./cn";
import styles from "./trace.module.css";

// Chain of Thought composition from shadcn/ui, adapted to Ovule's Radix primitives
// and theme tokens: https://ui.shadcn.com/docs/ai-elements/radix/chain-of-thought
export function Trace({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="trace" className={cn(styles.trace, className)} {...props} />;
}

export function TraceCollapsible({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible
      data-slot="trace-collapsible"
      className={cn(styles.collapsible, className)}
      {...props}
    />
  );
}

export function TraceCollapsibleTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      data-slot="trace-collapsible-trigger"
      className={cn(styles.trigger, className)}
      {...props}
    >
      {children}
      <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />
    </CollapsibleTrigger>
  );
}

export function TraceCollapsibleContent({
  className,
  keepMounted = false,
  ...props
}: ComponentProps<typeof CollapsibleContent> & { keepMounted?: boolean }) {
  return (
    <CollapsibleContent
      data-slot="trace-collapsible-content"
      forceMount={keepMounted ? true : undefined}
      className={cn(styles.content, className)}
      {...props}
    />
  );
}

export function TraceLine({
  className,
  status,
  ...props
}: ComponentProps<"span"> & { status?: "running" | "pending" | "error" }) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(styles.line, className)}
      {...props}
    />
  );
}

export function TraceIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn(styles.icon, className)}
      {...props}
    />
  );
}

export function TraceTitle({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="trace-title" className={cn(styles.title, className)} {...props} />;
}

export function TraceDescription({ className, ...props }: ComponentProps<"span">) {
  return (
    <span data-slot="trace-description" className={cn(styles.description, className)} {...props} />
  );
}
