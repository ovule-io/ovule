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
} from "@ovule/ui/attachment";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@ovule/ui/dialog";
import { File, ImageIcon, Link as LinkIcon } from "lucide-react";
import { createElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { cn } from "@ovule/ui/cn";
import styles from "./MessageParts.module.css";
import { workspaceOfficeTarget } from "./markdown-links";
import { UnavailablePart } from "./fallback-parts";
import { safeRemoteUrl, formatBytes, attachmentIdFromUrl } from "./part-assets";

const ImagePartFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  return function ImagePart({ part }: MessagePartRendererProps) {
    const { t } = useTranslation();
    const remoteSource = safeRemoteUrl(part.url);
    const attachmentId = attachmentIdFromUrl(part.url);
    const [attachmentSource, setAttachmentSource] = useState<{ id: string; url: string }>();
    const [failedSource, setFailedSource] = useState<string>();
    const [previewOpen, setPreviewOpen] = useState(false);
    const [loading, setLoading] = useState(Boolean(attachmentId));
    useEffect(() => {
      if (!attachmentId) {
        setLoading(false);
        setAttachmentSource(undefined);
        return;
      }
      setLoading(true);
      let active = true;
      let objectUrl: string | undefined;
      void workspace
        .api()
        .then((api) => api.readMessageAttachment(attachmentId))
        .then((bytes) => {
          if (!active) return;
          objectUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(bytes)], {
              type: part.mediaType ?? "application/octet-stream",
            }),
          );
          setAttachmentSource({ id: attachmentId, url: objectUrl });
          setLoading(false);
        })
        .catch(() => {
          if (active) {
            setAttachmentSource(undefined);
            setLoading(false);
          }
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [attachmentId, part.mediaType, workspace]);
    const source =
      remoteSource ?? (attachmentSource?.id === attachmentId ? attachmentSource?.url : undefined);
    const available = Boolean(source && failedSource !== source);
    const name = part.name ?? t("messageParts.image");
    const metadata = [part.mediaType?.split("/")[1]?.toUpperCase(), formatBytes(part.sizeBytes)]
      .filter(Boolean)
      .join(" · ");
    return (
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
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
          {available && (
            <AttachmentTrigger
              aria-label={t("messageParts.previewAttachment", { name })}
              onClick={() => setPreviewOpen(true)}
            />
          )}
        </Attachment>
        <DialogContent className={styles.attachmentDialog}>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{metadata || t("messageParts.image")}</DialogDescription>
          {available && <img className={styles.attachmentFullImage} src={source} alt={name} />}
        </DialogContent>
      </Dialog>
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
