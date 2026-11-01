import conversationTokens from "@ovule/conversation/conversation.token";
import { uniqueSetupParts } from "./setup-parts";
import { create, type ServiceOf } from "@ovule/ioc";
import { createElement, useSyncExternalStore } from "react";
import { useService } from "@ovule/ioc/react";
import type { MessagePartView } from "@ovule/shell-api";
import styles from "./MessageParts.module.css";
import { expandMessageBlocks } from "./message-blocks";
import { AttachmentGroup } from "@ovule/ui/attachment";
import { useTranslation } from "react-i18next";
import { ToolGroup, isToolPart } from "./tool-group";
import { UnknownPart } from "./fallback-parts";

export const MessagePartsFactory = create((dependsOn) => {
  const registry = dependsOn(conversationTokens.messagePresentationRegistry);
  return function MessageParts({
    parts,
    streaming,
    onCompose,
    renderBlocks = false,
  }: {
    renderBlocks?: boolean;
    onCompose?(prompt: string): void;
    parts: MessagePartView[];
    streaming: boolean;
  }) {
    useSyncExternalStore(registry.subscribe, registry.revision, registry.revision);
    const { t } = useTranslation();
    const visibleParts = renderBlocks
      ? expandMessageBlocks(parts, (kind) => Boolean(registry.renderer(kind)))
      : parts;
    const isAttachment = (part: MessagePartView) => part.kind === "image" || part.kind === "file";
    const groups: MessagePartView[][] = [];
    const priority = (part: MessagePartView) =>
      part.kind === "thinking" ? 0 : isToolPart(part) ? 1 : 2;
    for (const part of uniqueSetupParts(visibleParts).sort((a, b) => priority(a) - priority(b))) {
      const previous = groups.at(-1);
      if (
        previous &&
        ((isAttachment(part) && isAttachment(previous[0])) ||
          (isToolPart(part) && isToolPart(previous[0])))
      )
        previous.push(part);
      else groups.push([part]);
    }
    const render = (part: MessagePartView) => {
      const Renderer = registry.renderer(part.kind) ?? UnknownPart;
      return (
        <Renderer
          key={part.id}
          part={part}
          streaming={
            part.kind === "thinking"
              ? streaming && !parts.some((item) => item.kind === "markdown" && item.text?.trim())
              : streaming
          }
          onCompose={onCompose}
        />
      );
    };
    return (
      <div className={styles.messageParts}>
        {groups.map((group) =>
          isAttachment(group[0]) ? (
            <AttachmentGroup
              key={group[0].id}
              role="group"
              tabIndex={0}
              aria-label={t("messageParts.attachments")}
            >
              {group.map(render)}
            </AttachmentGroup>
          ) : isToolPart(group[0]) ? (
            <ToolGroup key={group[0].id} parts={group} streaming={streaming}>
              {group.map(render)}
            </ToolGroup>
          ) : (
            render(group[0])
          ),
        )}
      </div>
    );
  };
}, "MessageParts");

export const MessageParts = (...args: Parameters<ServiceOf<typeof MessagePartsFactory>>) =>
  createElement(useService(MessagePartsFactory), ...args);
