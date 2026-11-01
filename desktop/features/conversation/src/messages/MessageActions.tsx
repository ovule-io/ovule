import shellTokens from "@ovule/shell/shell.token";
import { useService } from "@ovule/ioc/react";
import { useState } from "react";
import { Check, Copy, Download, GitFork, Pencil } from "lucide-react";
import { Button } from "@ovule/ui/button";
import { useTranslation } from "react-i18next";
import styles from "./ConversationPane.module.css";

export function MessageActions({
  text,
  onEdit,
  onFork,
}: {
  text?: string;
  onEdit?(): void;
  onFork?(): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const shell = useService(shellTokens.shell);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const fork = async () => {
    if (busy || !onFork) return;
    setBusy(true);
    setError(false);
    try {
      if (!(await onFork())) setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const exportText = async (save: boolean) => {
    if (busy || !text) return;
    setBusy(true);
    setError(false);
    setCopied(false);
    try {
      if (save)
        await (
          await shell.dialog()
        ).saveFile(
          { title: t("conversation.saveMessage"), defaultPath: "message.md" },
          Array.from(new TextEncoder().encode(text)),
        );
      else if (await shell.copyText(text)) setCopied(true);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.messageActions}>
      {text?.trim() && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={t(copied ? "conversation.messageCopied" : "conversation.copyMessage")}
            title={t(copied ? "conversation.messageCopied" : "conversation.copyMessage")}
            onClick={() => void exportText(false)}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={t("conversation.saveMessage")}
            title={t("conversation.saveMessage")}
            onClick={() => void exportText(true)}
          >
            <Download size={12} />
          </Button>
        </>
      )}
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("conversation.editPrompt")}
          title={t("conversation.editPrompt")}
          disabled={busy}
          onClick={onEdit}
        >
          <Pencil size={12} />
        </Button>
      )}
      {onFork && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("conversation.forkMessage")}
          title={t("conversation.forkMessage")}
          disabled={busy}
          onClick={() => void fork()}
        >
          <GitFork size={12} />
        </Button>
      )}
      {error && <span role="alert">{t("conversation.messageActionError")}</span>}
    </div>
  );
}
