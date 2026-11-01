import type { SessionStatus } from "./model";

export type RemoteToolbarState = {
  status: SessionStatus;
  error: string;
  mode: string;
  quality: string;
};
export type RemoteToolbarHandlers = {
  reconnect(): void;
  clipboard(text: string): void;
  ctrlAltDelete(): void;
  syncClipboard?(): void;
  mode(value: RTCIceTransportPolicy): void;
  quality(value: string): void;
};

export function handleRemoteToolbarCommand(action: string, handlers: RemoteToolbarHandlers): void {
  const [name, ...parts] = action.split(":");
  const value = parts.join(":");
  switch (name) {
    case "remote.syncClipboard":
      handlers.syncClipboard?.();
      break;
    case "remote.reconnect":
      handlers.reconnect();
      break;
    case "remote.ctrlAltDelete":
      handlers.ctrlAltDelete();
      break;
    case "remote.clipboard":
      handlers.clipboard(value);
      break;
    case "remote.mode":
      if (value === "all" || value === "relay") handlers.mode(value);
      break;
    case "remote.quality":
      if (["balanced", "detail", "efficient", "responsive"].includes(value))
        handlers.quality(value);
      break;
  }
}
