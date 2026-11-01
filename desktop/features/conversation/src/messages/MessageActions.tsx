import { useState } from "react";
import { GitFork, Pencil } from "lucide-react";
import { Button } from "@ovule/ui/button";
import { useTranslation } from "react-i18next";
import styles from "./ConversationPane.module.css";

export function MessageActions({
  onEdit,
  onFork,
}: {
  onEdit?(): void;
  onFork?(): Promise<boolean>;
}) {
  const { t } = useTranslation();
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
  return (
    <div className={styles.messageActions}>
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
