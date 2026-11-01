import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { create, type ServiceOf } from "@ovule/ioc";
import { InlineCitation } from "@ovule/ui/inline-citation";
import { Button } from "@ovule/ui/button";
import { File } from "lucide-react";
import { createElement, type AnchorHTMLAttributes } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { MarkdownCode } from "./markdown-code";
import { useService } from "@ovule/ioc/react";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { cn } from "@ovule/ui/cn";
import styles from "./MessageParts.module.css";
import { rewriteLocalFileReferences, fileEditorForTarget } from "./markdown-links";
import { safeRemoteUrl } from "./part-assets";

const MarkdownPartFactory = create((dependsOn) => {
  const MarkdownLink = dependsOn(MarkdownLinkFactory);
  const registry = dependsOn(conversationTokens.messagePresentationRegistry);
  return function MarkdownPart({ part, streaming }: MessagePartRendererProps) {
    const markdown = rewriteLocalFileReferences(registry, part.text ?? "");
    return (
      <Streamdown
        className={styles.messageMarkdown}
        mode={streaming ? "streaming" : "static"}
        parseIncompleteMarkdown={streaming}
        controls={false}
        plugins={{ code }}
        components={{ a: MarkdownLink, code: MarkdownCode }}
      >
        {markdown}
      </Streamdown>
    );
  };
}, "MarkdownPart");

export const MarkdownPart = (...args: Parameters<ServiceOf<typeof MarkdownPartFactory>>) =>
  createElement(useService(MarkdownPartFactory), ...args);

type MarkdownLinkDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
  registry: ServiceOf<typeof conversationTokens.messagePresentationRegistry>;
};

function MarkdownLinkContent({
  dependencies,
  props: inputProps,
}: {
  dependencies: MarkdownLinkDependencies;
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown };
}) {
  const { workspace, registry } = dependencies;
  const { href, children, node: _node, ...props } = inputProps;

  const target = href?.startsWith("#ovule-preview=")
    ? decodeURIComponent(href.slice("#ovule-preview=".length))
    : undefined;
  if (target) {
    return (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={styles.messagePreviewLink}
        onClick={() => workspace.requestBrowserUse(target)}
      >
        {children}
      </Button>
    );
  }
  const officeTarget = href?.startsWith("#ovule-office=")
    ? decodeURIComponent(href.slice("#ovule-office=".length))
    : undefined;
  if (officeTarget) {
    const presentation = fileEditorForTarget(registry, officeTarget)?.threadPresentation ?? "link";
    if (presentation === "card") {
      return (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          className={cn(styles.messageAttachment, styles.messageLocalFileCard)}
          data-message-local-file-card="true"
          onClick={() => workspace.requestOfficeUse(officeTarget)}
        >
          <File />
          <span className={styles.messageAttachmentText}>
            <strong
              className={cn(
                styles.messageAttachmentLine,
                styles.messageAttachmentTitle,
                styles.messageLocalFileTitle,
              )}
            >
              {children}
            </strong>
            <small className={cn(styles.messageAttachmentLine, styles.messageAttachmentDetail)}>
              {officeTarget}
            </small>
          </span>
        </Button>
      );
    }
    return (
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className={styles.messagePreviewLink}
        onClick={() => workspace.requestOfficeUse(officeTarget)}
      >
        {children}
      </Button>
    );
  }
  const remoteTarget = safeRemoteUrl(href);
  const citationLabel = typeof children === "string" ? children.trim() : "";
  if (remoteTarget && /^\[?\d+(?:[,-]\d+)*\]?$/.test(citationLabel)) {
    return (
      <InlineCitation
        href={remoteTarget}
        title={inputProps.title || new URL(remoteTarget).hostname}
        onOpen={() => workspace.requestBrowserUse(remoteTarget)}
      >
        {children}
      </InlineCitation>
    );
  }
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => {
        if (!remoteTarget) return;
        event.preventDefault();
        workspace.requestBrowserUse(remoteTarget);
      }}
    >
      {children}
    </a>
  );
}

const MarkdownLinkFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const registry = dependsOn(conversationTokens.messagePresentationRegistry);
  const dependencies = { workspace, registry };
  return function MarkdownLink(
    props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown },
  ) {
    return createElement(MarkdownLinkContent, { dependencies, props });
  };
}, "MarkdownLink");

const MarkdownLink = (...args: Parameters<ServiceOf<typeof MarkdownLinkFactory>>) =>
  createElement(useService(MarkdownLinkFactory), ...args);
