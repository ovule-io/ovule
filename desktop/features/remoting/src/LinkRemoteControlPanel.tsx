import { useRemoteToolbarBridge } from "./useRemoteToolbarBridge";
import { installControlFeedback } from "@ovule/ui/control-feedback";
import remotingTokens from "./remoting.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { cn } from "@ovule/ui/cn";
import { Textarea } from "@ovule/ui/form";
import { Tooltip } from "@ovule/ui/tooltip";
import {
  Activity,
  Gauge,
  Keyboard,
  MousePointer2,
  RadioTower,
  ShieldCheck,
  Signal,
} from "lucide-react";
import {
  type CSSProperties,
  type CompositionEvent as ReactCompositionEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { connectionErrorKey } from "./connection-error";
import { SessionController } from "./controller";
import { isTextKey, TextCommitter } from "./keyboard";
import { remotePointerFromClient } from "./pointer";
import type { InputEvent as RemoteControlInput, NetworkStats, SessionStatus } from "./model";
import type { LinkRemoteControlSessionRequest } from "./session-links";

type Point = ReturnType<typeof remotePointerFromClient>;
type ActivePointer = Point & {
  button: "left" | "right" | "middle";
  pointerId: number;
  target: HTMLVideoElement;
};
type LinkRemoteControlPanelDependencies = {
  remoteControl: ServiceOf<typeof remotingTokens.remoteControl>;
};

function LinkRemoteControlPanelContent({
  dependencies,
  props,
}: {
  dependencies: LinkRemoteControlPanelDependencies;
  props: {
    tabId: string;
    request: LinkRemoteControlSessionRequest;
    requestVersion: number;
  };
}) {
  const i18n = useTranslation().i18n;

  const { remoteControl } = dependencies;
  const { tabId, request, requestVersion } = props;

  const { t } = useTranslation();
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<SessionStatus>("connecting");
  const [error, setError] = useState<string>();
  const [network, setNetwork] = useState<NetworkStats>();
  const [iceTransportPolicy, setIceTransportPolicy] = useState<RTCIceTransportPolicy>("all");
  const [quality, setQuality] = useState("balanced");
  const [frameSize, setFrameSize] = useState<CSSProperties>();
  const frameContainerRef = useRef<HTMLElement>(null);
  const feedbackRef = useRef<ReturnType<typeof installControlFeedback> | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteInputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<SessionController | undefined>(undefined);
  const activePointerRef = useRef<ActivePointer | undefined>(undefined);
  const composingRef = useRef(false);
  const physicalKeysRef = useRef(new Set<number>());
  const textCommitterRef = useRef(new TextCommitter());

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    composingRef.current = false;
    physicalKeysRef.current.clear();
    textCommitterRef.current = new TextCommitter();
    if (remoteInputRef.current) remoteInputRef.current.value = "";
    const controller = new SessionController(
      remoteControl,
      request.endpointId,
      {
        iceTransportPolicy,
        preferDetail: quality === "detail",
        targetFramerate: quality === "responsive" ? 120 : quality === "efficient" ? 30 : 60,
        maxBitrateKbps: quality === "detail" ? 30000 : quality === "efficient" ? 6000 : 12000,
      },
      video,
      (view) => {
        setStatus(view.status);
        setError(view.error);
        setNetwork(view.network);
      },
    );
    controllerRef.current = controller;
    const release = () => {
      feedbackRef.current?.clear();
      controller.releaseAll();
      physicalKeysRef.current.clear();
    };
    const visibility = () => {
      if (document.hidden) release();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    controller.start();
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      controller.close();
      if (controllerRef.current === controller) controllerRef.current = undefined;
      activePointerRef.current = undefined;
    };
  }, [generation, request.endpointId, requestVersion, remoteControl, quality, iceTransportPolicy]);

  useEffect(() => {
    const container = frameContainerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    const fitFrame = () => {
      if (!video.videoWidth || !video.videoHeight) {
        setFrameSize(undefined);
        return;
      }
      const style = getComputedStyle(container);
      const availableWidth =
        container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const availableHeight =
        container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const scale = Math.min(
        availableWidth / video.videoWidth,
        availableHeight / video.videoHeight,
      );
      const next = {
        width: Math.max(1, Math.floor(video.videoWidth * scale)),
        height: Math.max(1, Math.floor(video.videoHeight * scale)),
      };
      setFrameSize((current) =>
        current?.width === next.width && current?.height === next.height ? current : next,
      );
    };
    const observer = new ResizeObserver(fitFrame);
    observer.observe(container);
    video.addEventListener("loadedmetadata", fitFrame);
    video.addEventListener("resize", fitFrame);
    fitFrame();
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", fitFrame);
      video.removeEventListener("resize", fitFrame);
    };
  }, []);

  useEffect(() => {
    const host = frameContainerRef.current;
    if (!host || status !== "connected") return;
    const feedback = installControlFeedback(host);
    feedbackRef.current = feedback;
    return () => {
      feedback.dispose();
      feedbackRef.current = undefined;
    };
  }, [status]);

  const reconnect = () => setGeneration((value) => value + 1);
  const sendInput = (input: RemoteControlInput) => {
    if (status !== "connected") return;
    controllerRef.current?.send(input);
    const video = videoRef.current;
    const host = frameContainerRef.current;
    if (
      input.kind === "mouse" &&
      video &&
      host &&
      input.fractionalX !== undefined &&
      input.fractionalY !== undefined
    ) {
      const frame = video.getBoundingClientRect();
      const bounds = host.getBoundingClientRect();
      // The fitted video rectangle excludes letterboxing; source pixels never
      // become CSS coordinates without this explicit transform.
      feedbackRef.current?.pulse({
        x: frame.left - bounds.left + input.fractionalX * frame.width,
        y: frame.top - bounds.top + input.fractionalY * frame.height,
        pressed: input.buttonDown,
      });
    } else feedbackRef.current?.pulse();
  };
  const sendMove = (point: Point) => sendInput({ kind: "mouse", ...point });

  const pointFromPointer = (event: ReactPointerEvent<HTMLVideoElement>): Point => {
    const video = event.currentTarget;
    return remotePointerFromClient(
      event.clientX,
      event.clientY,
      video.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
    );
  };

  const pointerButton = (button: number): "left" | "right" | "middle" =>
    button === 2 ? "right" : button === 1 ? "middle" : "left";

  const onPointerDown = (event: ReactPointerEvent<HTMLVideoElement>) => {
    if (status !== "connected") return;
    event.preventDefault();
    const point = pointFromPointer(event);
    const button = pointerButton(event.button);
    activePointerRef.current = {
      ...point,
      button,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
    remoteInputRef.current?.focus({ preventScroll: true });
    sendInput({ kind: "mouse", ...point, button, buttonDown: true });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Native focus transitions can make capture unavailable; reliable input
      // ordering still preserves the drag without DOM pointer capture.
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLVideoElement>) => {
    if (status !== "connected") return;
    const point = pointFromPointer(event);
    const activePointer = activePointerRef.current;
    if (activePointer?.pointerId === event.pointerId) {
      event.preventDefault();
      activePointerRef.current = { ...activePointer, ...point };
    }
    sendMove(point);
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLVideoElement>) => {
    const activePointer = activePointerRef.current;
    if (!activePointer || activePointer.pointerId !== event.pointerId) return;
    sendInput({
      kind: "mouse",
      x: activePointer.x,
      y: activePointer.y,
      fractionalX: activePointer.fractionalX,
      fractionalY: activePointer.fractionalY,
      button: activePointer.button,
      buttonDown: false,
    });
    activePointerRef.current = undefined;
  };

  const releasePointer = (event: ReactPointerEvent<HTMLVideoElement>) => {
    event.preventDefault();
    const point = pointFromPointer(event);
    const activePointer = activePointerRef.current;
    const button = activePointer?.button ?? pointerButton(event.button);
    sendInput({ kind: "mouse", ...point, button, buttonDown: false });
    if (activePointer?.pointerId === event.pointerId) activePointerRef.current = undefined;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture can already be gone after a native focus transition.
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLVideoElement>) => {
    event.preventDefault();
    const point = pointFromPointer(event as unknown as ReactPointerEvent<HTMLVideoElement>);
    sendInput({
      kind: "mouse",
      ...point,
      wheelDeltaX: -event.deltaX,
      wheelDeltaY: -event.deltaY,
      wheelTicksX: -event.deltaX / 120,
      wheelTicksY: -event.deltaY / 120,
    });
  };

  const onKey = (event: ReactKeyboardEvent<HTMLElement>, pressed: boolean) => {
    if (status !== "connected") return;
    const usbKeycode = usbKeycodeFor(event.code);
    if (usbKeycode === undefined) return;
    // Release a forwarded shortcut even if modifiers or IME state changed.
    if (!pressed) {
      if (physicalKeysRef.current.delete(usbKeycode)) {
        event.preventDefault();
        sendInput({ kind: "key", usbKeycode, pressed: false });
      }
      return;
    }
    if (
      composingRef.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.key === "Process"
    )
      return;
    textCommitterRef.current.newKey();
    // The first printable keydown can precede compositionstart on macOS.
    if (isTextKey(event.nativeEvent)) return;
    event.preventDefault();
    physicalKeysRef.current.add(usbKeycode);
    sendInput({ kind: "key", usbKeycode, pressed });
  };

  const commitText = (text: string | undefined) => {
    if (text) sendInput({ kind: "text", text });
  };

  const onCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    commitText(textCommitterRef.current.compositionEnd(event.data));
    event.currentTarget.value = "";
  };

  const onTextInput = (event: ReactFormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || (event.nativeEvent as globalThis.InputEvent).isComposing) return;
    const input = event.currentTarget;
    commitText(textCommitterRef.current.input(input.value));
    input.value = "";
  };

  const pushClipboard = async (text: string) => {
    if (status !== "connected") return;
    try {
      await controllerRef.current?.pushClipboard(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const sendCtrlAltDelete = () => {
    for (const [usbKeycode, pressed] of [
      [0x0700e0, true],
      [0x0700e2, true],
      [0x07004c, true],
      [0x07004c, false],
      [0x0700e2, false],
      [0x0700e0, false],
    ] as const) {
      sendInput({ kind: "key", usbKeycode, pressed });
    }
  };

  useRemoteToolbarBridge(
    tabId,
    { status, error: error ?? "", mode: iceTransportPolicy, quality },
    {
      reconnect,
      clipboard: (text) => {
        void pushClipboard(text);
      },
      ctrlAltDelete: sendCtrlAltDelete,
      mode: setIceTransportPolicy,
      quality: setQuality,
    },
  );

  return (
    <main
      className="box-border grid h-full min-h-0 w-full min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-(--background)"
      data-remote-control-session={status}
    >
      <section
        ref={frameContainerRef}
        className="relative grid min-h-0 place-items-center overflow-hidden bg-black p-1"
        data-remote-control-frame
      >
        <Textarea
          ref={remoteInputRef}
          aria-label={t("spice.remoteTextInput")}
          className="absolute bottom-2 left-1/2 z-10 size-px -translate-x-1/2 resize-none opacity-0"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => onKey(event, true)}
          onKeyUp={(event) => onKey(event, false)}
          onCompositionStart={() => {
            composingRef.current = true;
            controllerRef.current?.releaseAll();
            physicalKeysRef.current.clear();
          }}
          onCompositionEnd={onCompositionEnd}
          onInput={onTextInput}
          onBlur={() => {
            controllerRef.current?.releaseAll();
            physicalKeysRef.current.clear();
          }}
        />
        <video
          ref={videoRef}
          className="max-h-full max-w-full cursor-default select-none object-contain outline-none"
          style={frameSize ?? { width: "100%", height: "100%" }}
          aria-label={t("spice.remoteFrame", { host: request.displayName })}
          autoPlay
          muted
          playsInline
          tabIndex={0}
          onFocus={() => remoteInputRef.current?.focus({ preventScroll: true })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          onLostPointerCapture={onLostPointerCapture}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={onWheel}
          onKeyDown={(event) => onKey(event, true)}
          onKeyUp={(event) => onKey(event, false)}
        />
        {status !== "connected" && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center text-white">
            <div className="grid max-w-md gap-2">
              <strong className="font-medium">{t(`spice.status.${status}`)}</strong>
              <span className="text-(length:--font-size-ui) text-white/70">
                {error ? t(connectionErrorKey(error)) : t("spice.linkConnectingHint")}
              </span>
              {error && (
                <details className="text-left text-xs text-white/60">
                  <summary className="cursor-pointer">{t("spice.connectionDetails")}</summary>
                  <p className="mt-2 break-words">{error}</p>
                </details>
              )}
            </div>
          </div>
        )}
      </section>
      <footer
        className="flex h-9 min-w-0 shrink-0 items-center gap-1 overflow-hidden border-t border-(--line) bg-(--surface) px-2 text-(--muted-foreground)"
        data-remote-control-statusbar
      >
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
          <MetricStatus
            title={t("spice.route")}
            value={
              network?.route === "relay"
                ? "TURN"
                : network?.route === "direct"
                  ? t("spice.routeDirect")
                  : "—"
            }
            description={[
              network?.routeDetail ?? t("spice.routePending"),
              network?.turnStatus && t(`spice.turnStatus.${network.turnStatus}`),
              network?.turnServers,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <RadioTower size={14} />
          </MetricStatus>
          <MetricStatus
            title="FPS"
            value={metric(network?.framesPerSecond)}
            description={i18n.t("spiceSession.decodedVideoFramesPerSecond")}
          >
            <Activity size={14} />
          </MetricStatus>
          <MetricStatus
            title={t("spice.latency")}
            value={`${metric(network?.latencyMs)} ms`}
            description={t("spice.latencyDescription")}
          >
            <Activity size={14} />
          </MetricStatus>
          <MetricStatus
            title={t("spice.jitter")}
            value={`${metric(network?.jitterMs)} ms`}
            description={t("spice.jitterDescription")}
          >
            <RadioTower size={14} />
          </MetricStatus>
          <MetricStatus
            title={t("spice.bandwidth")}
            value={formatBandwidth(network?.bandwidthKbps)}
            description={t("spice.bandwidthDescription")}
          >
            <Gauge size={14} />
          </MetricStatus>
          <MetricStatus
            title={t("spice.packetLoss")}
            value={`${network?.packetLossPercent?.toFixed(1) ?? "—"}%`}
            description={t("spice.packetLossDescription")}
          >
            <Signal size={14} />
          </MetricStatus>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <StatusIcon label={t("spice.keyboard")}>
            <Keyboard size={14} />
          </StatusIcon>
          <StatusIcon label={t("spice.mouse")}>
            <MousePointer2 size={14} />
          </StatusIcon>
          <StatusIcon label={t("spice.endToEndLink")}>
            <ShieldCheck size={14} />
          </StatusIcon>
        </div>
      </footer>
    </main>
  );
}

export const LinkRemoteControlPanelFactory = create((dependsOn) => {
  const remoteControl = dependsOn(remotingTokens.remoteControl);
  const dependencies = { remoteControl };
  return function LinkRemoteControlPanel(props: {
    tabId: string;
    request: LinkRemoteControlSessionRequest;
    requestVersion: number;
  }) {
    return createElement(LinkRemoteControlPanelContent, {
      dependencies,
      props,
    });
  };
}, "LinkRemoteControlPanel");

export const LinkRemoteControlPanel = (
  ...args: Parameters<ServiceOf<typeof LinkRemoteControlPanelFactory>>
) => useService(LinkRemoteControlPanelFactory)(...args);

function StatusIcon({
  label,
  children,
  dataStatus,
}: {
  label: string;
  children: ReactNode;
  dataStatus?: SessionStatus;
}) {
  useTranslation();
  return (
    <Tooltip side="top" content={label}>
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md text-(--muted-foreground) hover:bg-(--surface-3) hover:text-(--foreground)",
          dataStatus === "connected" && "bg-(--success-soft) text-(--success)",
          (dataStatus === "connecting" || dataStatus === "reconnecting") &&
            "bg-(--warning-soft) text-(--warning)",
          (dataStatus === "error" || dataStatus === "disconnected") &&
            "bg-(--danger-soft) text-(--danger)",
        )}
        role="status"
        aria-label={label}
        data-status={dataStatus}
      >
        {children}
      </span>
    </Tooltip>
  );
}

function MetricStatus({
  title,
  value,
  description,
  children,
}: {
  title: string;
  value: string;
  description: string;
  children: ReactNode;
}) {
  useTranslation();
  const label = `${title} ${value}`;
  return (
    <Tooltip side="top" content={`${label} · ${description}`}>
      <span
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-(length:--font-size-caption) text-(--muted-foreground) hover:bg-(--surface-3) hover:text-(--foreground)"
        role="status"
        aria-label={label}
      >
        {children}
        <span>{title}</span>
        <strong className="font-medium tabular-nums text-(--foreground)">{value}</strong>
      </span>
    </Tooltip>
  );
}

function metric(value?: number): string {
  return value === undefined ? "—" : String(Math.round(value));
}
function formatBandwidth(kbps?: number): string {
  if (kbps === undefined) return "—";
  return kbps >= 1_000 ? `${(kbps / 1_000).toFixed(1)} Mbps` : `${Math.round(kbps)} Kbps`;
}

function usbKeycodeFor(code: string): number | undefined {
  if (/^Key[A-Z]$/.test(code)) return 0x070004 + code.charCodeAt(3) - 65;
  if (/^Digit[1-9]$/.test(code)) return 0x07001e + Number(code.at(-1)) - 1;
  if (code === "Digit0") return 0x070027;
  return {
    Enter: 0x070028,
    Escape: 0x070029,
    Backspace: 0x07002a,
    Tab: 0x07002b,
    Space: 0x07002c,
    Minus: 0x07002d,
    Equal: 0x07002e,
    BracketLeft: 0x07002f,
    BracketRight: 0x070030,
    Backslash: 0x070031,
    Semicolon: 0x070033,
    Quote: 0x070034,
    Backquote: 0x070035,
    Comma: 0x070036,
    Period: 0x070037,
    Slash: 0x070038,
    CapsLock: 0x070039,
    PrintScreen: 0x070046,
    ScrollLock: 0x070047,
    Pause: 0x070048,
    Insert: 0x070049,
    Home: 0x07004a,
    PageUp: 0x07004b,
    Delete: 0x07004c,
    End: 0x07004d,
    PageDown: 0x07004e,
    ArrowRight: 0x07004f,
    ArrowLeft: 0x070050,
    ArrowDown: 0x070051,
    ArrowUp: 0x070052,
    ControlLeft: 0x0700e0,
    ShiftLeft: 0x0700e1,
    AltLeft: 0x0700e2,
    MetaLeft: 0x0700e3,
    ControlRight: 0x0700e4,
    ShiftRight: 0x0700e5,
    AltRight: 0x0700e6,
    MetaRight: 0x0700e7,
  }[code];
}
