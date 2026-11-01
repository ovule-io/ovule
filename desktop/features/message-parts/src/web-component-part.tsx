import conversationTokens from "@ovule/conversation/conversation.token";
import { useObservableState } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { create, type ServiceOf } from "@ovule/ioc";
import { createElement, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import styles from "./MessageParts.module.css";
import { safeExtensionAssetUrl } from "./part-assets";
import { isMessageBlockAction, runMessageBlockAction } from "./extension-action";

type WebComponentMessagePartDependencies = {
  conversation: ServiceOf<typeof conversationTokens.conversationState>;
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function WebComponentMessagePartContent({
  dependencies,
  props,
}: {
  dependencies: WebComponentMessagePartDependencies;
  props: MessagePartRendererProps & {
    extensionId: string;
    registry: CustomElementRegistry;
    scoped: boolean;
    styleUrl?: string;
    tag: string;
  };
}) {
  const latestCompose = useRef(props.onCompose);
  latestCompose.current = props.onCompose;
  const i18n = useTranslation().i18n;

  const { workspace, conversation } = dependencies;
  const threads = useObservableState(conversation, (state) => state.snapshot?.threads);
  const { extensionId, registry, scoped, styleUrl, tag, part, streaming } = props;

  useTranslation();
  const host = useRef<HTMLDivElement | null>(null);
  const element = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!host.current || element.current) return;
    try {
      const root =
        host.current.shadowRoot ??
        (scoped
          ? host.current.attachShadow({
              mode: "open",
              customElementRegistry: registry,
            })
          : host.current.attachShadow({ mode: "open" }));
      const block = scoped
        ? document.createElement(tag, { customElementRegistry: registry })
        : document.createElement(tag);
      if (!(block instanceof HTMLElement)) {
        throw new Error(`Message Block module could not create ${tag}`);
      }
      block.style.display = "block";
      // Each block owns its content height (charts size their own surface).
      block.lang = i18n.language;
      if (styleUrl) {
        const url = safeExtensionAssetUrl(styleUrl, ".css");
        if (!url) throw new Error(`Unsafe Message Block style: ${styleUrl}`);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        root.prepend(link);
      }
      block.dataset.messageBlockKind = part.kind;
      const actions = new AbortController();
      block.addEventListener("ovule:extension-action", (event) => {
        const detail = (
          event as CustomEvent<{ action?: unknown; connectionId?: unknown; threadId?: unknown }>
        ).detail;
        if (!isMessageBlockAction(detail?.action)) {
          return;
        }
        event.stopPropagation();
        void runMessageBlockAction(
          workspace,
          extensionId,
          {
            action: detail.action,
            connectionId: typeof detail.connectionId === "string" ? detail.connectionId : undefined,
            threadId: typeof detail.threadId === "string" ? detail.threadId : undefined,
          },
          i18n.t("messageList.extensionActionReturnedInvalidJSON"),
          (result) =>
            block.dispatchEvent(
              new CustomEvent("ovule:extension-action-result", { detail: result }),
            ),
          actions.signal,
        );
      });
      block.addEventListener("ovule:compose", (event) => {
        const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail?.prompt;
        if (typeof prompt === "string" && prompt.trim() && prompt.length <= 16384) {
          event.stopPropagation();
          latestCompose.current?.(prompt);
        }
      });
      root.append(block);
      element.current = block;
      host.current.dataset.extensionId = extensionId;
      host.current.dataset.registry = scoped ? "scoped" : "isolated-tag-fallback";
      host.current.dataset.runtimeTag = tag;
      host.current.dataset.customElement =
        registry.get(tag) && block.constructor !== HTMLElement ? "upgraded" : "unresolved";
      if (host.current.dataset.customElement !== "upgraded") {
        throw new Error(`Message Block custom element ${tag} was not upgraded`);
      }
      return () => {
        actions.abort();
        block.remove();
        root.replaceChildren();
        element.current = null;
      };
    } catch (error) {
      renderMessageBlockError(host.current, part.kind, error);
    }
  }, [extensionId, part.kind, registry, scoped, styleUrl, tag, workspace]);
  useEffect(() => {
    if (!element.current) return;
    let payload = null;
    try {
      payload = part.dataJson ? JSON.parse(part.dataJson) : null;
      Object.assign(element.current, { data: payload });
    } catch {
      element.current.dataset.invalidPayload = "true";
      renderMessageBlockError(host.current, part.kind);
    }
  }, [part.dataJson]);
  useEffect(() => {
    if (!element.current) return;
    element.current.lang = i18n.language;
    Object.assign(element.current, { streaming });
  }, [streaming, i18n.language]);
  useEffect(() => {
    if (element.current && part.kind === "channel-setup") {
      Object.assign(element.current, {
        threads: (threads ?? []).map((thread) => ({ id: thread.id, title: thread.title })),
      });
    }
  }, [part.kind, threads]);
  return (
    <div ref={host} className={styles.messageExtensionBlock} data-message-block-kind={part.kind} />
  );
}

const WebComponentMessagePartFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const conversation = dependsOn(conversationTokens.conversationState);
  const dependencies = { workspace, conversation };
  return function WebComponentMessagePart(
    props: MessagePartRendererProps & {
      extensionId: string;
      registry: CustomElementRegistry;
      scoped: boolean;
      styleUrl?: string;
      tag: string;
    },
  ) {
    return createElement(WebComponentMessagePartContent, {
      dependencies,
      props,
    });
  };
}, "WebComponentMessagePart");

export const WebComponentMessagePart = (
  ...args: Parameters<ServiceOf<typeof WebComponentMessagePartFactory>>
) => useService(WebComponentMessagePartFactory)(...args);

function renderMessageBlockError(host: HTMLElement | null, kind: string, error?: unknown) {
  if (!host) return;
  if (error) console.error(`Failed to mount ${kind} Message Block`, error);
  const fallback = document.createElement("div");
  fallback.className = styles.messageExtensionError;
  fallback.textContent = `Unable to render ${kind} block.`;
  host.shadowRoot?.replaceChildren(fallback);
  if (!host.shadowRoot) host.replaceChildren(fallback);
}
