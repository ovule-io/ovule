import type { TFunction } from "i18next";
import { Square } from "lucide-react";
import { InputGroupButton } from "@ovule/ui/input-group";
import { PromptInputSubmit } from "@ovule/ui/prompt-input";

export function GenerationControl({
  running,
  stopping,
  sending,
  canSend,
  onStop,
  translate: t,
  className,
}: {
  running: boolean;
  stopping: boolean;
  sending: boolean;
  canSend: boolean;
  onStop?(): Promise<void>;
  translate: TFunction;
  className?: string;
}) {
  return running ? (
    <InputGroupButton
      type="button"
      size="icon"
      className={className}
      aria-label={t(stopping ? "conversation.stopping" : "conversation.stopGeneration")}
      title={t(stopping ? "conversation.stopping" : "conversation.stopGeneration")}
      disabled={stopping || !onStop}
      onClick={() => void onStop?.()}
    >
      <Square size={16} />
    </InputGroupButton>
  ) : (
    <PromptInputSubmit
      busy={sending}
      className={className}
      size="icon"
      aria-label={t("conversation.send")}
      title={t(
        !canSend
          ? "conversation.enterMessage"
          : sending
            ? "conversation.sending"
            : "conversation.send",
      )}
      disabled={!canSend || sending}
    />
  );
}
