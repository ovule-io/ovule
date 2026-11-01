import { useRemoteToolbarBridge } from "./useRemoteToolbarBridge";
import { Clipboard, Keyboard, MousePointer2, ShieldCheck } from "lucide-react";
import { SpiceMainConn, sendCtrlAltDel } from "spice-client";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PaneContext } from "@ovule/panes/pane";
import { decodeSpiceSession } from "./session-links-codec";

type SessionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export function LegacySpiceSessionPanel({ id, target, requestVersion }: PaneContext) {
  const { t } = useTranslation();
  const request = decodeSpiceSession(target);
  const screenId = `spice-screen-${useId().replaceAll(":", "")}`;
  const connectionRef = useRef<SpiceMainConn | undefined>(undefined);
  const retryRef = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<SessionStatus>("connecting");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!request) return;
    let disposed = false;
    let retryTimer: number | undefined;
    const scheduleReconnect = () => {
      if (disposed || retryTimer !== undefined) return;
      const delay = Math.min(15_000, 1_000 * 2 ** retryRef.current);
      retryRef.current += 1;
      setStatus("reconnecting");
      retryTimer = window.setTimeout(() => setGeneration((value) => value + 1), delay);
    };
    setStatus(generation ? "reconnecting" : "connecting");
    setError(undefined);
    const connection = new SpiceMainConn({
      uri: request.websocketUrl,
      screen_id: screenId,
      scale_view: true,
      onsuccess: () => {
        if (disposed) return;
        retryRef.current = 0;
        setStatus("connected");
        setError(undefined);
      },
      onerror: (cause: Error) => {
        if (disposed) return;
        setStatus("error");
        setError(cause.message || String(cause));
        scheduleReconnect();
      },
    });
    const onConnectionStatus = (next: string) => {
      if (disposed) return;
      if (next === "connected") {
        retryRef.current = 0;
        setStatus("connected");
      } else if (next === "disconnected" || next === "error") {
        scheduleReconnect();
      }
    };
    connection.on("connection_status", onConnectionStatus);
    connectionRef.current = connection;
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      connection.off("connection_status", onConnectionStatus);
      connection.stop();
      if (connectionRef.current === connection) connectionRef.current = undefined;
    };
  }, [generation, request?.websocketUrl, requestVersion, screenId]);

  const reconnect = () => {
    retryRef.current = 0;
    connectionRef.current?.stop();
    setGeneration((value) => value + 1);
  };

  useRemoteToolbarBridge(
    id,
    { status, error: error ?? "", mode: "", quality: "" },
    {
      reconnect,
      clipboard: () => {},
      ctrlAltDelete: () => {
        if (status === "connected" && connectionRef.current) sendCtrlAltDel(connectionRef.current);
      },
      syncClipboard: () => {
        if (status === "connected") connectionRef.current?.send_clipboard_grab();
      },
      mode: () => {},
      quality: () => {},
    },
  );

  if (!request) {
    return (
      <main
        className="grid h-full place-items-center bg-(--background) p-6 text-(--danger)"
        role="alert"
      >
        {t("spice.invalidSession")}
      </main>
    );
  }

  return (
    <main
      className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-(--background)"
      data-spice-session={status}
    >
      <section className="relative min-h-0 overflow-hidden bg-black">
        <div
          id={screenId}
          className="grid h-full w-full place-items-center overflow-hidden outline-none"
          tabIndex={0}
        />
        {status !== "connected" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-white">
            <div className="grid max-w-md gap-2">
              <strong className="font-medium">{t(`spice.status.${status}`)}</strong>
              <span className="text-(length:--font-size-ui) text-white/70">
                {error ?? t("spice.connectingHint")}
              </span>
            </div>
          </div>
        )}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-(--line) bg-(--surface) px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-(length:--font-size-caption) text-(--muted-foreground)">
          <span className="inline-flex items-center gap-1">
            <Keyboard size={13} /> {t("spice.keyboard")}
          </span>
          <span className="inline-flex items-center gap-1">
            <MousePointer2 size={13} /> {t("spice.mouse")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clipboard size={13} /> {t("spice.clipboard")}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck size={13} /> {t("spice.websocketBridge")}
          </span>
        </div>
      </footer>
    </main>
  );
}
