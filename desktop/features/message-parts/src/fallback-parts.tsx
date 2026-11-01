import { File, Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { cn } from "@ovule/ui/cn";
import styles from "./MessageParts.module.css";

export function UnknownPart({ part }: MessagePartRendererProps) {
  const { t } = useTranslation();
  return <UnavailablePart icon={Puzzle} label={t("messageParts.unknown", { kind: part.kind })} />;
}

export function UnavailablePart({ icon: Icon, label }: { icon: typeof File; label: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn(styles.messageAttachment, styles.unavailable)}>
      <Icon />
      <span className={styles.messageAttachmentText}>
        <strong className={cn(styles.messageAttachmentLine, styles.messageAttachmentTitle)}>
          {label}
        </strong>
        <small className={cn(styles.messageAttachmentLine, styles.messageAttachmentDetail)}>
          {t("messageParts.noRenderer")}
        </small>
      </span>
    </div>
  );
}
