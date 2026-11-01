import { useTranslation } from "react-i18next";
import { Reasoning } from "@ovule/ui/reasoning";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { MarkdownPart } from "./markdown-part";

export function ThinkingPart(props: MessagePartRendererProps) {
  const { part, streaming } = props;
  const { t } = useTranslation();
  let text = "";
  try {
    const value = JSON.parse(part.dataJson ?? "{}");
    text = typeof value?.text === "string" ? value.text : "";
  } catch {
    /* Malformed optional reasoning does not hide the answer. */
  }
  return (
    <Reasoning
      running={streaming}
      label={t(streaming ? "messageList.thinking" : "messageList.thoughts")}
      hasContent={Boolean(text.trim())}
    >
      <MarkdownPart {...props} part={{ ...part, text }} />
    </Reasoning>
  );
}
