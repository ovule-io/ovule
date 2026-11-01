import type { ComponentProps } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "./cn";

export function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("ui-resizable-group", className)}
      {...props}
    />
  );
}

export function ResizablePanel({
  className,
  ...props
}: ComponentProps<typeof Panel>) {
  return (
    <Panel
      data-slot="resizable-panel"
      className={cn("ui-resizable-panel", className)}
      {...props}
    />
  );
}

export function ResizableHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn("ui-resizable-handle", className)}
      {...props}
    />
  );
}

export { usePanelRef } from "react-resizable-panels";
