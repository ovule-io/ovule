import { useRef, useState, type ReactNode } from "react";
import { MessageActions } from "./MessageActions";
import { PromptEditor } from "./PromptEditor";
import { Bot, Bug, CircleStop, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import {
  Message,
  MessageAvatar,
  MessageBubble,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@ovule/ui/message";
import styles from "./ConversationPane.module.css";

/** One AI Elements turn. Role presentation and metadata live here so ordinary
 * replies and workflow-only turns share the same structure. */
export function ConversationMessage({
  role,
  status,
  author,
  createdAt,
  error,
  onTelemetry,
  children,
  actions,
  prompt,
  notice,
  onRestart,
  onFork,
}: {
  role: string;
  status?: string;
  author: string;
  createdAt?: number;
  error?: string;
  onTelemetry?(): void;
  children: ReactNode;
  actions?: ReactNode;
  prompt?: string;
  notice?: string;
  onRestart?(text: string): Promise<boolean>;
  onFork?(): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editingWidth, setEditingWidth] = useState(240);
  const card = useRef<HTMLElement>(null);
  const from = role === "user" ? "user" : role === "system" ? "system" : "assistant";
  return (
    <Message from={from}>
      {from !== "user" && (
        <MessageAvatar title={author}>
          <Bot size={14} />
        </MessageAvatar>
      )}
      <MessageContent
        className={styles.messageContent}
        style={editing ? { width: editingWidth } : undefined}
      >
        <article
          ref={card}
          className={cn("message-card", styles.messageCard, styles[from])}
          data-message-role={role}
          data-message-status={status}
        >
          <MessageHeader className={styles.messageAuthor}>{author}</MessageHeader>
          {from === "user" ? (
            <MessageBubble>
              {editing && onRestart ? (
                <PromptEditor
                  text={prompt ?? ""}
                  onCancel={() => setEditing(false)}
                  onSubmit={async (text) => {
                    const succeeded = await onRestart(text);
                    if (succeeded) setEditing(false);
                    return succeeded;
                  }}
                />
              ) : (
                children
              )}
            </MessageBubble>
          ) : (
            children
          )}
          {status === "cancelled" ? (
            <p className={styles.statusNotice} role="status">
              <CircleStop size={13} />
              {t("messageList.stopped")}
            </p>
          ) : notice ? (
            <details className={styles.statusNotice}>
              <summary>
                <TriangleAlert size={13} />
                {t("messageList.replyFailed")}
              </summary>
              <pre>{notice}</pre>
            </details>
          ) : null}
          {(createdAt !== undefined ||
            onTelemetry ||
            error ||
            actions ||
            onFork ||
            onRestart ||
            prompt) && (
            <MessageFooter className={styles.messageMeta}>
              {error && (
                <span role="alert" className={styles.messageError}>
                  {error}
                </span>
              )}
              {createdAt !== undefined && (
                <time dateTime={new Date(createdAt).toISOString()}>
                  {new Date(createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              )}
              {!editing && (
                <>
                  {actions}
                  {(prompt?.trim() || onFork || (from === "user" && onRestart)) && (
                    <MessageActions
                      text={prompt}
                      onFork={onFork}
                      onEdit={
                        from === "user" && onRestart
                          ? () => {
                              setEditingWidth(
                                Math.max(240, card.current?.getBoundingClientRect().width ?? 240),
                              );
                              setEditing(true);
                            }
                          : undefined
                      }
                    />
                  )}
                </>
              )}
              {onTelemetry && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className={styles.messageDebug}
                  aria-label={t("conversation.telemetryOpen")}
                  title={t("conversation.telemetryOpen")}
                  onClick={onTelemetry}
                >
                  <Bug size={10} />
                </Button>
              )}
            </MessageFooter>
          )}
        </article>
      </MessageContent>
    </Message>
  );
}
