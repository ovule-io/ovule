import { useEffect, useRef, useState } from "react";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { mountInteractiveFrame } from "./interactive-frame";
import styles from "./MessageParts.module.css";

/** A host UI contribution: no extension script or isolated world is created. */
export function IframeMessagePart({ part, onCompose }: MessagePartRendererProps) {
  const host = useRef<HTMLDivElement>(null);
  const latestCompose = useRef(onCompose);
  latestCompose.current = onCompose;
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    setError("");
    try {
      const value = part.dataJson ? JSON.parse(part.dataJson) : null;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Interactive content is unavailable");
      return mountInteractiveFrame(host.current, value, (prompt) =>
        latestCompose.current?.(prompt),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [part.dataJson]);
  return (
    <div
      className={styles.messageExtensionBlock}
      data-message-block-kind={part.kind}
      data-renderer="sandbox-iframe"
    >
      <div ref={host} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
