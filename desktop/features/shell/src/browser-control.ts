import { createBrowserAgent, type BrowserAgentBinding } from "./browser-agent";
export { snapshotScript, actionScript } from "./browser-scripts";

type Request = {
  requestId: string;
  attemptId: string;
  threadId?: string;
  arguments: Record<string, unknown>;
};
type Bridge = {
  addEventListener(type: "channel", listener: (event: Event) => void): void;
  removeEventListener(type: "channel", listener: (event: Event) => void): void;
};
export type BrowserSurfacePresenter = (
  agent: BrowserAgentBinding,
  url: string,
  threadId?: string,
) => void;
export function installBrowserControl(present?: BrowserSurfacePresenter): () => void {
  const bridge = (globalThis as typeof globalThis & { tuffite?: Bridge }).tuffite;
  if (!bridge) return () => {};
  const sessions = new Map<string, BrowserAgentBinding>();
  const blocked = new Set<string>();
  const queues = new Map<string, Promise<unknown>>();
  let disposed = false;
  const close = (attemptId: string) => {
    const session = sessions.get(attemptId);
    const alreadyClosed = session?.status() === "closed";
    session?.close();
    sessions.delete(attemptId);
    if (!alreadyClosed) blocked.delete(attemptId);
  };
  const execute = async (request: Request): Promise<unknown> => {
    if (disposed) throw new Error("Browser renderer disposed");
    const action = request.arguments.action;
    if (action === "close") {
      close(request.attemptId);
      if (!request.requestId) blocked.delete(request.attemptId);
      return { closed: true };
    }
    let session = sessions.get(request.attemptId);
    if (action === "open" && !session) {
      if (blocked.has(request.attemptId)) throw new Error("User closed this Attempt's browser");
      if (sessions.size >= 4) throw new Error("Browser surface capacity exceeded");
      if (!present) throw new Error("Browser overlay host unavailable");
      session = createBrowserAgent(
        {
          attemptId: request.attemptId,
          partition: `memory:agent-${crypto.randomUUID()}`,
          userControl: false,
        },
        () => blocked.add(request.attemptId),
      );
      sessions.set(request.attemptId, session);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        present(session, String(request.arguments.url), request.threadId);
        await Promise.race([
          session.ready,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Browser overlay did not mount")), 10000);
          }),
        ]);
      } catch (error) {
        close(request.attemptId);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!session) throw new Error("Open this Attempt's browser before using it");
    return session.call(request.arguments);
  };
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<{ channel: string; data: Uint8Array }>).detail;
    if (detail?.channel !== "ovule:browser-command") return;
    let request: Request;
    try {
      request = JSON.parse(new TextDecoder().decode(detail.data)) as Request;
      if (
        typeof request.requestId !== "string" ||
        typeof request.attemptId !== "string" ||
        !request.arguments
      )
        return;
    } catch {
      return;
    }
    if (!request.requestId && request.arguments.action === "close") {
      close(request.attemptId);
      blocked.delete(request.attemptId);
      queues.delete(request.attemptId);
      return;
    }
    const pending = (queues.get(request.attemptId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => execute(request));
    queues.set(request.attemptId, pending);
    void pending
      .then(
        (result) => respond(result),
        (error: unknown) => respond({ error: String(error) }),
      )
      .finally(() => {
        if (queues.get(request.attemptId) === pending) queues.delete(request.attemptId);
      })
      .catch(() => {
        /* The native bridge may close before an outstanding response. */
      });
    async function respond(result: unknown) {
      if (request.requestId) {
        const api = await import("@ovule/shell-api");
        await api.browser.respond(request.requestId, JSON.stringify(result));
      }
    }
  };
  bridge.addEventListener("channel", receive);
  return () => {
    disposed = true;
    bridge.removeEventListener("channel", receive);
    for (const id of sessions.keys()) close(id);
    blocked.clear();
  };
}
