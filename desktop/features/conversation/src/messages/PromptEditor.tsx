import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@ovule/ui/form";
import styles from "./ConversationPane.module.css";

/** Replace the prompt content in its existing bubble; never submit during IME composition. */
export function PromptEditor({
  text,
  onCancel,
  onSubmit,
}: {
  text: string;
  onCancel(): void;
  onSubmit(text: string): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(text.length, text.length);
  }, [text]);
  useLayoutEffect(() => {
    const element = input.current;
    if (element) {
      element.style.height = "0px";
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [draft]);
  const submit = async () => {
    if (submitting.current || !draft.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError(false);
    try {
      if (!(await onSubmit(draft))) setError(true);
    } catch {
      setError(true);
    } finally {
      submitting.current = false;
      setBusy(false);
      input.current?.focus();
    }
  };
  return (
    <div className={styles.promptEditor}>
      <Textarea
        ref={input}
        aria-label={t("conversation.editPrompt")}
        aria-busy={busy}
        value={draft}
        readOnly={busy}
        rows={1}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onCancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            void submit();
          }
        }}
      />
      {error && <span role="alert">{t("conversation.messageActionError")}</span>}
    </div>
  );
}
