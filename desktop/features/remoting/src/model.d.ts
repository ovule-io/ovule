export type SessionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export type InputEvent =
  | { kind: "key"; usbKeycode: number; pressed: boolean }
  | { kind: "text"; text: string }
  | {
      kind: "mouse";
      x?: number;
      y?: number;
      fractionalX?: number;
      fractionalY?: number;
      button?: "left" | "middle" | "right" | "back" | "forward";
      buttonDown?: boolean;
      wheelDeltaX?: number;
      wheelDeltaY?: number;
      wheelTicksX?: number;
      wheelTicksY?: number;
    };

export type NetworkStats = {
  latencyMs?: number;
  jitterMs?: number;
  bandwidthKbps?: number;
  packetLossPercent?: number;
  framesPerSecond?: number;
  decodeMs?: number;
  jitterBufferMs?: number;
  framesDropped?: number;
  route?: "direct" | "relay";
  routeDetail?: string;
  turnServers?: string;
  turnStatus?: "configured" | "unavailable" | "missing";
  codec?: string;
};

export type SessionView = {
  status: SessionStatus;
  error?: string;
  network?: NetworkStats;
};

export type ControlApi = import("@ovule/shell-api").OvuleApi["remoting"];

export type ControlUpdate = Awaited<ReturnType<ControlApi["snapshot"]>>;

export type ConnectionOptions = {
  iceTransportPolicy?: RTCIceTransportPolicy;
  preferDetail?: boolean;
  targetFramerate: number;
  maxBitrateKbps: number;
  screenId?: bigint;
};
