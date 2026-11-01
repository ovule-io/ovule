import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { create, type ServiceOf } from "@ovule/ioc";
import {
  Attachment,
  AttachmentPreview,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentTrigger,
  AttachmentActions,
} from "@ovule/ui/attachment";
import shellTokens from "@ovule/shell/shell.token";
import { useImageActions, useImageAttachment } from "./image-attachment";
import { Copy, Download, File, ImageIcon, Link as LinkIcon } from "lucide-react";
import { createElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { cn } from "@ovule/ui/cn";
import styles from "./MessageParts.module.css";
import { workspaceOfficeTarget } from "./markdown-links";
import { UnavailablePart } from "./fallback-parts";
import { safeRemoteUrl, formatBytes } from "./part-assets";

const ImagePartFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  return function ImagePart({ part }: MessagePartRendererProps) {
    const { t } = useTranslation();
    const { source, loading, blob } = useImageAttachment(part);
    const [failedSource, setFailedSource] = useState<string>();
    const [previewError, setPreviewError] = useState(false);
    const actions = useImageActions(part, source, blob);
    const preview = async () => {
      setPreviewError(false);
      const request = {
        kind: "image-preview",
        url: part.url,
        name: part.name,
        mediaType: part.mediaType,
        sizeBytes: part.sizeBytes?.toString(),
      };
      try {
        if (["thread", "pane"].includes(document.documentElement.dataset.surface ?? ""))
          await shell.requestRoot("ui.dialog.open", request);
        else window.dispatchEvent(new CustomEvent("ovule:global-dialog", { detail: request }));
      } catch {
        setPreviewError(true);
      }
    };
    const available = Boolean(source && failedSource !== source);
    const name = part.name ?? t("messageParts.image");
    const metadata = [part.mediaType?.split("/")[1]?.toUpperCase(), formatBytes(part.sizeBytes)]
      .filter(Boolean)
      .join(" · ");
    return (
      <>
        <Attachment
          orientation="vertical"
          state={loading ? "processing" : available ? "done" : "error"}
        >
          <AttachmentMedia variant="image">
            {source && failedSource !== source ? (
              <AttachmentPreview
                src={source}
                alt={name}
                loading="lazy"
                onError={() => setFailedSource(source)}
              />
            ) : (
              <ImageIcon aria-hidden="true" />
            )}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={name}>{name}</AttachmentTitle>
            <AttachmentDescription>
              {loading
                ? t("messageParts.loadingAttachment")
                : available
                  ? metadata || t("messageParts.image")
                  : t("messageParts.imageUnavailable")}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions className={styles.imageActions}>
            <FeedbackButton
              label={t("messageParts.copyImage")}
              successLabel={t("messageParts.imageAction.copied")}
              variant="ghost"
              size="icon"
              className={styles.imageAction}
              disabled={!available || actions.busy}
              action={actions.copy}
            >
              <Copy size={14} />
            </FeedbackButton>
            <FeedbackButton
              label={t("messageParts.saveImage")}
              successLabel={t("messageParts.imageAction.saved")}
              variant="ghost"
              size="icon"
              className={styles.imageAction}
              disabled={!available || actions.busy}
              action={actions.save}
            >
              <Download size={14} />
            </FeedbackButton>
          </AttachmentActions>
          {available && (
            <AttachmentTrigger
              aria-label={t("messageParts.previewAttachment", { name })}
              onClick={() => void preview()}
            />
          )}
          {previewError && (
            <span className={styles.imagePreviewError} role="alert">
              {t("messageParts.imageAction.failed")}
            </span>
          )}
        </Attachment>
      </>
    );
  };
}, "ImagePart");

export const ImagePart = (...args: Parameters<ServiceOf<typeof ImagePartFactory>>) =>
  createElement(useService(ImagePartFactory), ...args);

const LinkPartFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  return function LinkPart({ part }: MessagePartRendererProps) {
    const { t } = useTranslation();
    const target = safeRemoteUrl(part.url);
    return target ? (
      <a
        className={styles.messageAttachment}
        href={target}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => {
          event.preventDefault();
          workspace.requestBrowserUse(target);
        }}
      >
        <LinkIcon />
        <span className={styles.messageAttachmentText}>
          <strong className={cn(styles.messageAttachmentLine, styles.messageAttachmentTitle)}>
            {part.name ?? part.url}
          </strong>
          <small className={cn(styles.messageAttachmentLine, styles.messageAttachmentDetail)}>
            {part.url}
          </small>
        </span>
      </a>
    ) : (
      <UnavailablePart icon={LinkIcon} label={part.name ?? t("messageParts.unsafeLink")} />
    );
  };
}, "LinkPart");

export const LinkPart = (...args: Parameters<ServiceOf<typeof LinkPartFactory>>) =>
  createElement(useService(LinkPartFactory), ...args);

const FilePartFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const registry = dependsOn(conversationTokens.messagePresentationRegistry);
  return function FilePart({ part }: MessagePartRendererProps) {
    const { t } = useTranslation();
    const officeTarget = workspaceOfficeTarget(registry, part.url);
    const target = safeRemoteUrl(part.url);
    const name = part.name ?? t("messageParts.file");
    const extension = part.name?.split(".").slice(1).pop()?.toUpperCase();
    const description =
      [extension || part.mediaType, formatBytes(part.sizeBytes)].filter(Boolean).join(" · ") ||
      t("messageParts.attachment");
    const open = officeTarget
      ? () => workspace.requestOfficeUse(officeTarget)
      : target
        ? () => workspace.requestBrowserUse(target)
        : undefined;
    return (
      <Attachment orientation="horizontal">
        <AttachmentMedia>
          <File aria-hidden="true" />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle title={name}>{name}</AttachmentTitle>
          <AttachmentDescription title={description}>{description}</AttachmentDescription>
        </AttachmentContent>
        {open && (
          <AttachmentTrigger
            aria-label={t("messageParts.openAttachment", { name })}
            onClick={open}
          />
        )}
      </Attachment>
    );
  };
}, "FilePart");

export const FilePart = (...args: Parameters<ServiceOf<typeof FilePartFactory>>) =>
  createElement(useService(FilePartFactory), ...args);
