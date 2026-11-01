import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";

import { cn } from "./cn";

export function Steps({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root className={cn("ui-steps", className)} {...props} />
  );
}

export function StepsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List className={cn("ui-steps-list", className)} {...props} />
  );
}

export function StepTrigger({
  className,
  step,
  label,
  completed = false,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & {
  step: number;
  label: string;
  completed?: boolean;
}) {
  return (
    <TabsPrimitive.Trigger
      className={cn("ui-step-trigger", className)}
      data-completed={completed || undefined}
      {...props}
    >
      <span className="ui-step-index">{step}</span>
      <span className="ui-step-label">{label}</span>
    </TabsPrimitive.Trigger>
  );
}

export function StepContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("ui-step-content", className)}
      {...props}
    />
  );
}
