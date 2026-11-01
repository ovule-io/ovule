import type {
  ExplorerNavigationState,
  ExplorerOpenRequest,
  ExplorerDialog,
  ExplorerTransfer,
  ExplorerElement,
  TuffiteMessageEvent,
  TuffiteMessageApi,
} from "./explorer";

export function tuffiteMessageApi(): TuffiteMessageApi | undefined {
  return (globalThis as typeof globalThis & { tuffite?: TuffiteMessageApi }).tuffite;
}

export async function requestRoot<T>(channel: string, payload: unknown): Promise<T> {
  const tuffite = tuffiteMessageApi();
  if (!tuffite) throw new Error("Tuffite message API is unavailable");
  const requestId = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`App message timed out: ${channel}`));
    }, 30_000);
    const receive = (event: TuffiteMessageEvent) => {
      if (event.origin !== location.origin) return;
      const response = event.data as {
        type?: unknown;
        requestId?: unknown;
        result?: unknown;
        error?: unknown;
      } | null;
      if (response?.type !== "app-response" || response.requestId !== requestId) return;
      cleanup();
      if (typeof response.error === "string" && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.result as T);
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      tuffite.removeEventListener("message", receive);
    };
    tuffite.addEventListener("message", receive);
    try {
      tuffite.postMessage(
        { type: "app-request", requestId, channel, payload },
        { targetOrigin: location.origin },
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
