import { useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MessagePartView } from "@ovule/shell-api";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
  TraceDescription,
} from "@ovule/ui/trace";
import { chatPartData, chatToolPresentation } from "./chat-part-data";

export const isToolPart = (part: MessagePartView) =>
  ["tool", "tool-call", "tool-result"].includes(part.kind);

/** Match Reasoning: live by default, collapsed at completion; preserve deliberate toggles. */
export function ToolGroup({
  parts,
  streaming,
  children,
}: {
  parts: MessagePartView[];
  streaming: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>();
  const { t } = useTranslation();
  const states = parts.map((part) =>
    chatToolPresentation(chatPartData(part.dataJson), streaming, part.kind === "tool-result"),
  );
  const failures = states.filter((state) => state === "failed").length;
  const errors = states.filter((state) => state === "error").length;
  return (
    <Trace data-tool-group>
      <TraceCollapsible open={open ?? streaming} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={streaming ? "running" : undefined}>
            <TraceIcon>
              <Wrench />
            </TraceIcon>
            <TraceTitle>
              {t(streaming ? "messageList.toolsRunning" : "messageList.tools", {
                count: parts.length,
              })}
            </TraceTitle>
            {errors > 0 && (
              <TraceDescription>{t("messageList.toolErrors", { count: errors })}</TraceDescription>
            )}
            {failures > 0 && (
              <TraceDescription>
                {t("messageList.toolsFailed", { count: failures })}
              </TraceDescription>
            )}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{children}</TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
