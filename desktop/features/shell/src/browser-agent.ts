import type { ExplorerElement } from "./explorer";
import type { TFunction } from "i18next";
import { actionScript, snapshotScript, webUrl } from "./browser-scripts";

type Arguments = Record<string, unknown>;
import type { BrowserAgentBinding, BrowserAgentMetadata } from "./explorer";
export type { BrowserAgentBinding, BrowserAgentMetadata } from "./explorer";
export function createBrowserAgent(
  metadata: BrowserAgentMetadata,
  onClosed: () => void,
): BrowserAgentBinding {
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  let userControl = metadata.userControl,
    moving = false,
    closed = false;
  let generation = metadata.generation ?? 0,
    documentId: string | undefined;
  let element: ExplorerElement | undefined, remote: MessagePort | undefined;
  let inFlight: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const surfaces = new Map<ExplorerElement, { close(): void; dispose(): void }>();
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const changed = () => listeners.forEach((listener) => listener());
  const invalidate = () => {
    generation++;
    documentId = undefined;
  };
  const remoteCall = (args: Arguments) =>
    new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Browser window did not reply"));
      }, 15000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      remote!.postMessage({ type: "call", id, args });
    });
  const localCall = async (args: Arguments): Promise<unknown> => {
    const action = args.action;
    if (closed) throw new Error("User closed this Attempt's browser");
    if (moving) throw new Error("Browser surface is moving; retry with a fresh snapshot");
    if (remote) return remoteCall(args);
    const target = element;
    if (!target?.isConnected) throw new Error("Browser surface is unavailable");
    if (userControl && !["snapshot", "screenshot"].includes(String(action)))
      throw new Error("User has control; wait for explicit return of control");
    if (action === "open" || action === "navigate") {
      const url = webUrl(args.url);
      invalidate();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Browser navigation timed out"));
        }, 15000);
        const loaded = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new Error("Browser navigation failed"));
        };
        const cleanup = () => {
          clearTimeout(timer);
          target.removeEventListener("loadstop", loaded);
          target.removeEventListener("loaderror", failed);
        };
        target.addEventListener("loadstop", loaded);
        target.addEventListener("loaderror", failed);
        target.load(url);
      });
      target.dispatchEvent(new CustomEvent("ovule:control-activity", { detail: {} }));
      return { url: (await target.getNavigationState()).url };
    }
    if (action === "screenshot") {
      const image = await target.capturePreview();
      if (!image.startsWith("data:image/png;base64,"))
        throw new Error("Explorer capture is unavailable");
      return {
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: image.slice("data:image/png;base64,".length),
          },
        ],
        isError: false,
      };
    }
    if (action === "snapshot") {
      const state = await target.getNavigationState();
      documentId = state.documentId;
      generation++;
      return target.executeJavaScript(snapshotScript(generation), {
        world: "isolated",
        expectedDocumentId: state.documentId,
      });
    }
    if (!documentId) throw new Error("A fresh snapshot is required before input");
    const result = await target.executeJavaScript(actionScript(generation, args), {
      world: "isolated",
      expectedDocumentId: documentId,
    });
    invalidate();
    target.dispatchEvent(new CustomEvent("ovule:control-activity", { detail: result }));
    return result;
  };
  const agent: BrowserAgentBinding = {
    attemptId: metadata.attemptId,
    partition: metadata.partition,
    ready,
    status: () => (closed ? "closed" : moving ? "moving" : userControl ? "user" : "agent"),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggleControl() {
      if (closed || moving) return;
      if (remote) {
        remote.postMessage({ type: "toggle" });
        return;
      }
      userControl = !userControl;
      invalidate();
      changed();
    },
    bind(target, closeSurface) {
      if (closed) {
        closeSurface();
        return () => {};
      }
      const committed = () => {
        if (element === target) invalidate();
      };
      const navigate = (event: Event) => {
        if (element !== target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const url = (event as CustomEvent<{ url?: string }>).detail?.url;
        if (url) {
          try {
            target.load(webUrl(url));
          } catch {
            userControl = true;
            invalidate();
            changed();
          }
        }
      };
      target.addEventListener("loadcommit", committed);
      for (const kind of ["navigation", "open", "popup", "newwindow"])
        target.addEventListener(kind, navigate, true);
      const dispose = () => {
        target.removeEventListener("loadcommit", committed);
        for (const kind of ["navigation", "open", "popup", "newwindow"])
          target.removeEventListener(kind, navigate, true);
      };
      surfaces.set(target, { close: closeSurface, dispose });
      agent.activate(target);
      readyResolve();
      return () => {
        dispose();
        surfaces.delete(target);
        if (element === target && !moving && !remote && !closed) agent.close();
      };
    },
    activate(target) {
      element = target;
      invalidate();
    },
    async beginTransfer() {
      moving = true;
      invalidate();
      changed();
      await inFlight.catch(() => {});
    },
    finishTransfer() {
      moving = false;
      invalidate();
      changed();
    },
    prepareWindow() {
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => {
        if (data?.type === "state") {
          userControl = data.status === "user";
          if (data.status === "closed") agent.close();
          else changed();
        } else if (data?.type === "result") {
          const reply = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) reply?.reject(new Error(String(data.error)));
          else reply?.resolve(data.result);
        }
      };
      channel.port1.start();
      return {
        port: channel.port2,
        metadata: { ...metadata, userControl, generation },
        commit() {
          remote = channel.port1;
          element = undefined;
          invalidate();
          changed();
        },
        cancel() {
          channel.port1.close();
          channel.port2.close();
        },
      };
    },
    call(args) {
      inFlight = localCall(args);
      return inFlight;
    },
    close() {
      if (closed) return;
      closed = true;
      invalidate();
      remote?.postMessage({ type: "close" });
      remote?.close();
      for (const entry of pending.values()) entry.reject(new Error("Browser session closed"));
      pending.clear();
      const current = element && surfaces.get(element);
      for (const surface of surfaces.values()) surface.dispose();
      surfaces.clear();
      element = undefined;
      current?.close();
      changed();
      onClosed();
    },
  };
  return agent;
}
export function receiveBrowserAgent(
  port: MessagePort,
  metadata: BrowserAgentMetadata,
  element: ExplorerElement,
  closeSurface: () => void,
): BrowserAgentBinding {
  const agent = createBrowserAgent(metadata, () =>
    port.postMessage({ type: "state", status: "closed" }),
  );
  agent.bind(element, closeSurface);
  agent.subscribe(() => port.postMessage({ type: "state", status: agent.status() }));
  port.onmessage = async ({ data }) => {
    if (data?.type === "close") {
      agent.close();
      port.close();
    } else if (data?.type === "toggle") agent.toggleControl();
    else if (data?.type === "call") {
      try {
        port.postMessage({ type: "result", id: data.id, result: await agent.call(data.args) });
      } catch (error) {
        port.postMessage({ type: "result", id: data.id, error: String(error) });
      }
    }
  };
  port.start();
  return agent;
}
export function installAgentBrowserControls(
  host: HTMLElement,
  agent: BrowserAgentBinding,
  t: TFunction,
): () => void {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.agentControl = "";
  button.className = "ui-button px-2 text-xs";
  const update = () => {
    button.textContent = t(
      agent.status() === "user" ? "browser.agentResume" : "browser.agentTakeControl",
    );
    button.disabled = ["moving", "closed"].includes(agent.status());
    host.dataset.control = agent.status();
  };
  button.onclick = () => agent.toggleControl();
  host.append(button);
  update();
  const unsubscribe = agent.subscribe(update);
  return () => {
    unsubscribe();
    button.remove();
  };
}
