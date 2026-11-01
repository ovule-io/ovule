import type { ControlUpdate } from "./model";
import type { RemoteControlService } from "./remoting";
const isNative =
  typeof window !== "undefined" &&
  typeof (globalThis as typeof globalThis & { tuffite?: { invoke?: unknown } }).tuffite?.invoke ===
    "function";

type BridgeEvent = Event & { detail: { channel: string; data: Uint8Array } };
type Bridge = {
  addEventListener(type: "channel", handler: (event: BridgeEvent) => void): void;
  removeEventListener(type: "channel", handler: (event: BridgeEvent) => void): void;
};
export const nativeRemoteControlService: RemoteControlService = {
  async api() {
    if (!isNative) throw new Error("Remote desktop is available in the native Ovule application");
    return (await import("@ovule/shell-api")).remoting;
  },
  observe(listener) {
    const bridge = (globalThis as typeof globalThis & { tuffite?: Bridge }).tuffite;
    if (!bridge) return () => undefined;
    const decoder = new TextDecoder();
    const receive = (event: BridgeEvent) => {
      if (event.detail.channel !== "ovule:remote-control") return;
      try {
        const update = JSON.parse(decoder.decode(event.detail.data)) as ControlUpdate;
        if (typeof update.sessionId !== "string" || !Array.isArray(update.signals)) return;
        update.signals = update.signals.map((signal) => ({
          ...signal,
          sequence: BigInt(signal.sequence),
        }));
        listener(update);
      } catch {
        /* The periodic snapshot repairs missed or invalid optional events. */
      }
    };
    bridge.addEventListener("channel", receive);
    return () => bridge.removeEventListener("channel", receive);
  },
};
