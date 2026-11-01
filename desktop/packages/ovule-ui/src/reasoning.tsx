import { useState, type ReactNode } from "react";
import { Brain } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "./trace";

/** shadcn AI Elements Reasoning pattern. A manual toggle takes priority over
 * automatic streaming expansion, including when the answer begins. */
export function Reasoning({
  running,
  label,
  children,
  hasContent = true,
}: {
  running: boolean;
  label: string;
  children?: ReactNode;
  hasContent?: boolean;
}) {
  const [open, setOpen] = useState<boolean>();
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        <Brain />
      </TraceIcon>
      <TraceTitle aria-live="polite">{label}</TraceTitle>
    </TraceLine>
  );
  return (
    <Trace>
      {hasContent ? (
        <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent keepMounted>{children}</TraceCollapsibleContent>
        </TraceCollapsible>
      ) : (
        line
      )}
    </Trace>
  );
}
