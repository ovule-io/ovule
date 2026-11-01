import type { BrowserAgentBinding } from "@ovule/shell/explorer";
import type { ExplorerElement, ExplorerTransfer } from "@ovule/shell/explorer";
import type { ShellService } from "@ovule/shell/shell";
import type { WindowInfo } from "@ovule/shell/window";

export function requireExplorerTransfer(source: ExplorerElement): void {
  if (typeof source.detach !== "function" || typeof source.attach !== "function")
    throw new DOMException(
      "This Tuffite runtime does not support Explorer transfer",
      "NotSupportedError",
    );
}

export async function recoverExplorerTransfer(
  source: ExplorerElement,
  transfer: ExplorerTransfer,
): Promise<boolean> {
  let generation = 0;
  let wake: (() => void) | undefined;
  const changed = () => {
    generation++;
    wake?.();
    wake = undefined;
  };
  const waitForChange = (since: number) =>
    generation !== since
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          wake = resolve;
        });
  const state = () => transfer.state;
  transfer.addEventListener("statechange", changed);
  try {
    for (;;) {
      if (state() === "attaching") {
        await waitForChange(generation);
        continue;
      }
      if (state() === "transferred") return true;
      if (state() === "closed") return false;
      let restoreError: unknown;
      if (source.isConnected) {
        try {
          await source.attach(transfer);
          return false;
        } catch (error) {
          restoreError = error;
        }
      }
      // State notifications and attach replies use different Mojo pipes. A
      // rejection can arrive before the handle learns that the child is busy.
      // A rejected close is a native busy indication: wait for its state update
      // instead of cancelling a child that may already own the page.
      const beforeClose = generation;
      try {
        await transfer.close();
      } catch (error) {
        if (state() === "transferred") return true;
        if (state() === "closed") return false;
        if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
        await waitForChange(beforeClose);
        continue;
      }
      if (state() === "transferred") return true;
      if (restoreError) throw restoreError;
      return false;
    }
  } finally {
    transfer.removeEventListener("statechange", changed);
    wake = undefined;
  }
}

export function waitForExplorerTarget(tabId: string): Promise<ExplorerElement> {
  return new Promise((resolve, reject) => {
    const find = () => {
      const target = document.querySelector<ExplorerElement>(
        `[data-explorer-transfer-target="${CSS.escape(tabId)}"]`,
      );
      if (!target) return;
      cleanup();
      resolve(target);
    };
    const observer = new MutationObserver(find);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Explorer target did not become ready"));
    }, 10_000);
    const cleanup = () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    observer.observe(document.body, { childList: true, subtree: true });
    find();
  });
}

export async function openExplorerWindow(
  source: ExplorerElement,
  url: string,
  shell: Pick<ShellService, "window">,
  onPrepared?: () => void,
  agent?: BrowserAgentBinding,
): Promise<void> {
  requireExplorerTransfer(source);
  const api = await shell.window();
  const channelId = crypto.randomUUID();
  const destination = new URL(url);
  destination.searchParams.set("transfer", channelId);
  const channel = new BroadcastChannel(`ovule:explorer-transfer:${channelId}`);
  let child: WindowInfo | undefined;
  let transfer: ExplorerTransfer | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const acknowledgement = new MessageChannel();
  const agentTransfer = agent?.prepareWindow();
  let agentCommitted = false;
  let removePreview: (() => void) | undefined;
  try {
    const ready = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Independent Explorer window timed out")), 15_000);
      channel.onmessage = ({ data }) => {
        if (data?.type === "ready") resolve();
      };
    });
    void ready.catch(() => {});
    child = await api.create({
      url: destination.href,
      title: "Ovule Browser",
      bounds: { x: 100, y: 100, width: 1100, height: 760 },
      focused: true,
    });
    if (typeof child.postMessage !== "function")
      throw new DOMException("This runtime cannot transfer Explorer windows", "NotSupportedError");
    await ready;
    clearTimeout(timer);
    const preview = await captureExplorerTransferPreview(source);
    removePreview = await showExplorerTransferPreview(source, preview);
    onPrepared?.();
    transfer = await source.detach();
    const result = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Independent Explorer attach timed out")), 15_000);
      acknowledgement.port1.onmessage = ({ data }) => {
        if (data?.type === "attached") resolve();
        if (data?.type === "error") {
          // A rejected attach returns exclusive ownership through this port.
          if (data.handle) transfer = data.handle;
          reject(new Error(String(data.error)));
        }
      };
    });
    void result.catch(() => {});
    child.postMessage(
      {
        type: "attach-explorer",
        session: channelId,
        handle: transfer,
        preview,
        agent: agentTransfer?.metadata,
      },
      {
        targetOrigin: destination.origin,
        transfer: [transfer, acknowledgement.port2, ...(agentTransfer ? [agentTransfer.port] : [])],
      },
    );
    await result;
    agentTransfer?.commit();
    agentCommitted = true;
  } catch (error) {
    // Native ownership is authoritative when an acknowledgement is late.
    // Recovery waits for an attaching receiver and never closes a committed one.
    if (transfer && (await recoverExplorerTransfer(source, transfer))) {
      agentTransfer?.commit();
      agentCommitted = true;
      return;
    }
    if (child) channel.postMessage({ type: "cancel" });
    throw error;
  } finally {
    clearTimeout(timer);
    if (!agentCommitted) agentTransfer?.cancel();
    removePreview?.();
    channel.close();
    acknowledgement.port1.close();
    acknowledgement.port2.close();
  }
}

export async function captureExplorerTransferPreview(source: ExplorerElement): Promise<string> {
  try {
    // PDF pages are painted by the app above the native surface.
    const page = source.parentElement?.querySelector<HTMLCanvasElement>(
      ".explorer-pdf canvas[data-rendered]",
    );
    if (page?.width && page.height) return page.toDataURL("image/png");
    if (typeof source.capturePreview !== "function") return "";
    return await source.capturePreview();
  } catch {
    return "";
  }
}
export async function showExplorerTransferPreview(
  target: ExplorerElement,
  preview: string,
): Promise<() => void> {
  if (!preview || !target.parentElement) return () => {};
  const image = document.createElement("img");
  image.className = "explorer-transfer-preview";
  image.alt = "";
  image.src = preview;
  target.parentElement.append(image);
  await image.decode().catch(() => {});
  let leaving = false;
  return () => {
    if (leaving) return;
    leaving = true;
    if (!image.isConnected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      image.remove();
      return;
    }
    const animation = image.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 160,
      easing: "ease-out",
      fill: "forwards",
    });
    void animation.finished.catch(() => {}).finally(() => image.remove());
  };
}

export function beginExplorerOverlayExit(source: ExplorerElement): {
  finished: Promise<void>;
  cancel: () => void;
} {
  const panel = source.closest<HTMLElement>("[data-explorer-preview]");
  const backdrop = panel?.previousElementSibling;
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140;
  const animations = [panel, backdrop].flatMap((element) =>
    element instanceof HTMLElement
      ? [
          element.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration,
            easing: "ease-out",
            fill: "forwards",
          }),
        ]
      : [],
  );
  return {
    finished: Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(
      () => {},
    ),
    cancel: () => animations.forEach((animation) => animation.cancel()),
  };
}
export async function waitForExplorerPaint(target: ExplorerElement): Promise<void> {
  // CopyFromSurface waits for the newly attached compositor surface. The
  // attach reply alone only confirms ownership, before that frame is visible.
  if (typeof target.capturePreview === "function") await target.capturePreview().catch(() => "");
  const host = target.parentElement;
  const viewer = host?.querySelector<HTMLElement>(".explorer-pdf");
  if (viewer && viewer.dataset.ready !== "true") {
    await new Promise<void>((resolve) => {
      const finish = () => {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      };
      const observer = new MutationObserver(() => {
        const current = host?.querySelector<HTMLElement>(".explorer-pdf");
        if (!current || current.dataset.ready === "true") finish();
      });
      const timer = setTimeout(finish, 10_000);
      observer.observe(host!, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    });
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
