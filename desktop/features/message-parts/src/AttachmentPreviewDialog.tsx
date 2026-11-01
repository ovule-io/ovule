import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Download } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ovule/ui/dialog";
import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import type { AttachmentPreviewRequest } from "./message-parts";
import { useImageAttachment, useImageActions } from "./image-attachment";
import { formatBytes } from "./part-assets";
import styles from "./MessageParts.module.css";

export function AttachmentPreviewDialog({
  request,
  onOpenChange,
}: {
  request: AttachmentPreviewRequest;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const size =
    request.sizeBytes && /^\d{1,12}$/.test(request.sizeBytes)
      ? BigInt(request.sizeBytes)
      : undefined;
  const part = { ...request, id: "attachment-preview", kind: "image", sizeBytes: size };
  const { source, loading, blob } = useImageAttachment(part);
  const [failed, setFailed] = useState(false);
  const actions = useImageActions(part, source, blob);
  const name = request.name || t("messageParts.image");
  const metadata = [request.mediaType?.split("/")[1]?.toUpperCase(), formatBytes(size)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={styles.attachmentDialog} closeLabel={t("common.closeDialog")}>
        <DialogTitle>{name}</DialogTitle>
        <DialogDescription>{metadata || t("messageParts.image")}</DialogDescription>
        <div className={styles.attachmentPreviewActions}>
          <FeedbackButton
            label={t("messageParts.copyImage")}
            successLabel={t("messageParts.imageAction.copied")}
            className={styles.imageFeedback}
            variant="ghost"
            size="sm"
            disabled={!source || failed || actions.busy}
            action={actions.copy}
          >
            <Copy size={14} />
            {t("messageParts.copyImage")}
          </FeedbackButton>
          <FeedbackButton
            label={t("messageParts.saveImage")}
            successLabel={t("messageParts.imageAction.saved")}
            className={styles.imageFeedback}
            variant="ghost"
            size="sm"
            disabled={!source || failed || actions.busy}
            action={actions.save}
          >
            <Download size={14} />
            {t("messageParts.saveImage")}
          </FeedbackButton>
        </div>
        {source && !failed ? (
          <img
            className={styles.attachmentFullImage}
            src={source}
            alt={name}
            onError={() => setFailed(true)}
          />
        ) : (
          <p role="status">
            {t(loading ? "messageParts.loadingAttachment" : "messageParts.imageUnavailable")}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
