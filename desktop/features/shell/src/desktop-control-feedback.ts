import { installControlFeedback } from "@ovule/ui/control-feedback";

type ActivityBridge = {
  addEventListener(type: "channel", listener: (event: Event) => void): void;
  removeEventListener(type: "channel", listener: (event: Event) => void): void;
};

/** Native Agent input feedback in the Ovule window. Physical desktop coordinates
 * are deliberately not projected onto an unrelated application viewport. */
export function installDesktopControlFeedback(): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: ActivityBridge }).tuffite;
  if (!bridge || !document.body) return () => {};
  const feedback = installControlFeedback(document.body, { desktop: true });
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<{ channel: string; data: Uint8Array }>).detail;
    if (detail?.channel !== "ovule:computer-use-activity") return;
    // Payload intentionally contains no input text, clipboard, or screenshot.
    feedback.pulse();
  };
  const clear = () => {
    if (document.hidden) feedback.clear();
  };
  bridge.addEventListener("channel", receive);
  document.addEventListener("visibilitychange", clear);
  return () => {
    bridge.removeEventListener("channel", receive);
    document.removeEventListener("visibilitychange", clear);
    feedback.dispose();
  };
}
