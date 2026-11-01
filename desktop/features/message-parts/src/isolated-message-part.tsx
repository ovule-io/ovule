import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import type { MessageBlockContributionView } from "@ovule/shell-api";
import type { MountIsolated, IsolatedView } from "@ovule/shell/isolated";
import { isMessageBlockAction, runMessageBlockAction } from "./extension-action";
import styles from "./MessageParts.module.css";

export function IsolatedMessagePart(
  props: MessagePartRendererProps & {
    contribution: MessageBlockContributionView;
    mount: MountIsolated;
  },
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<IsolatedView | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const workspace = useService(workspaceTokens.workspace);
  const { i18n } = useTranslation();
  const [error, setError] = useState("");
  const { contribution, mount, part } = props;
  useEffect(() => {
    if (!host.current || !contribution.tag) return;
    let active = true;
    let mounted: IsolatedView | undefined;
    const properties = () => ({
      data: latest.current.part.dataJson ? JSON.parse(latest.current.part.dataJson) : null,
      streaming: latest.current.streaming,
      lang: i18n.language,
    });
    const container = host.current;
    const tag = contribution.tag;
    void Promise.resolve()
      .then(() =>
        mount(
          container,
          contribution.extensionId,
          tag,
          properties(),
          async ({ method, params, signal }) => {
            const input = params as {
              prompt?: unknown;
              action?: unknown;
              connectionId?: unknown;
            } | null;
            if (
              method === "compose" &&
              typeof input?.prompt === "string" &&
              input.prompt.trim() &&
              input.prompt.length <= 16384
            ) {
              latest.current.onCompose?.(input.prompt);
              return null;
            }
            if (method !== "extension.action" || !isMessageBlockAction(input?.action))
              throw new Error("Unsupported message UI request");
            let response: unknown = null;
            await runMessageBlockAction(
              workspace,
              contribution.extensionId,
              {
                action: input.action,
                connectionId:
                  typeof input.connectionId === "string" ? input.connectionId : undefined,
              },
              "Invalid action response",
              (result) => {
                response = result;
              },
              signal,
            );
            return response;
          },
        ),
      )
      .then(async (value) => {
        mounted = value;
        if (!active) {
          await value.dispose();
          return;
        }
        view.current = value;
        await value.update(properties());
      })
      .catch((cause) => {
        if (active) setError(String(cause.message ?? cause));
      });
    return () => {
      active = false;
      view.current = undefined;
      void mounted?.dispose();
    };
  }, [contribution.extensionId, contribution.tag, mount, workspace]);
  useEffect(() => {
    if (!view.current) return;
    try {
      void view.current
        .update({
          data: part.dataJson ? JSON.parse(part.dataJson) : null,
          streaming: props.streaming,
          lang: i18n.language,
        })
        .catch((cause) => setError(String(cause)));
    } catch (cause) {
      setError(String(cause));
    }
  }, [part.dataJson, props.streaming, i18n.language]);
  return (
    <div
      className={styles.messageExtensionBlock}
      data-message-block-kind={part.kind}
      data-extension-id={contribution.extensionId}
      data-registry="isolated-world"
    >
      <div ref={host} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
