import type { BrowserAgentBinding } from "@ovule/shell/explorer";
import shellTokens from "@ovule/shell/shell.token";
import { useService } from "@ovule/ioc/react";
import browserTokens from "@ovule/browser/browser.token";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw } from "lucide-react";
import { Button } from "@ovule/ui/button";
import type { ExplorerDialog, ExplorerElement, ExplorerOpenRequest } from "@ovule/shell/explorer";
import { useTranslation } from "react-i18next";

export default function IndependentExplorerRoute() {
  const { showExplorerTransferPreview, waitForExplorerPaint, FileBreadcrumbs } = useService(
    browserTokens.routeRuntime,
  );
  const {
    installExplorerResources,
    receiveBrowserAgent,
    installAgentBrowserControls,
    loadExplorer,
    localExplorerAddress,
    listLocalDirectory,
  } = useService(shellTokens.shell);
  const { openPopupWindow, windowApi, explorerOpenDestination } = useService(
    shellTokens.routeRuntime,
  );
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const agentControls = useRef<HTMLDivElement>(null);
  const [agentId, setAgentId] = useState<string>();
  const explorer = useRef<ExplorerElement | null>(null);
  const [navigation, setNavigation] = useState({ url: "", canGoBack: false, canGoForward: false });
  const pendingAddress = useRef<string | undefined>(undefined);
  const navigate = (url: string) => {
    pendingAddress.current = url.startsWith("file:") ? url : undefined;
    setNavigation((previous) => ({ ...previous, url }));
    if (explorer.current) loadExplorer(explorer.current, url);
  };
  const go = (offset: -1 | 1) => {
    pendingAddress.current = undefined;
    void (offset === -1 ? explorer.current?.back() : explorer.current?.forward());
  };
  const [error, setError] = useState("");
  useEffect(() => {
    const channelId = new URLSearchParams(location.search).get("transfer");
    if (!channelId || !host.current) {
      setError(i18n.t("app.noExplorerTransferIsAvailable"));
      return;
    }
    const element = document.createElement("explorer") as ExplorerElement;
    element.setAttribute("isolated", "");
    element.behavior = "navigation: delegate;";
    element.behavior += " dialog: delegate;";
    element.contextMenuEnabled = true;
    element.className = "block h-full w-full border-0";
    host.current.replaceChildren(element);
    const removeResources = installExplorerResources?.(element, i18n.t) ?? (() => {});
    explorer.current = element;
    const channel = new BroadcastChannel(`ovule:explorer-transfer:${channelId}`);
    let disposed = false;
    let agent: BrowserAgentBinding | undefined;
    let removeControls: (() => void) | undefined;
    let attaching = false;
    let expired = false;
    let attached = false;
    const closeEmptyWindow = () => {
      if (!disposed && !attaching && !attached)
        void windowApi()
          .then((api) => api.close())
          .catch(console.error);
    };
    const timer = setTimeout(() => {
      expired = true;
      closeEmptyWindow();
    }, 15_000);
    const sync = () => {
      void element
        .getNavigationState()
        .then((state) => {
          if (disposed || element.dataset.previewPending === "true") return;
          const url = localExplorerAddress(state.url);
          if (url === "about:blank" || (pendingAddress.current && pendingAddress.current !== url))
            return;
          pendingAddress.current = undefined;
          setNavigation({ ...state, url });
          document.title = state.title || state.url || i18n.t("browser.ovuleBrowser");
        })
        .catch(console.error);
    };
    const open = (event: Event) => {
      const reported = (event as CustomEvent<ExplorerOpenRequest>).detail;
      const detail = reported
        ? { ...reported, url: localExplorerAddress(reported.url) }
        : undefined;
      if (!detail?.url || !/^(?:https?|file):\/\//i.test(detail.url)) return;
      event.stopPropagation();
      const destination = explorerOpenDestination(event.type, detail);
      if (destination === "ignore") return;
      if (destination === "popup") void openPopupWindow(detail.url).catch(console.error);
      else navigate(detail.url);
    };
    const dialog = async (event: Event) => {
      const request = (event as CustomEvent<ExplorerDialog>).detail;
      event.stopPropagation();
      if (request.type === "alert") {
        window.alert(request.message);
        await request.accept();
      } else if (request.type === "prompt") {
        const answer = window.prompt(request.message, request.defaultValue);
        await (answer === null ? request.dismiss() : request.accept(answer));
      } else await (window.confirm(request.message) ? request.accept() : request.dismiss());
    };
    element.addEventListener("dialog", dialog);
    element.addEventListener("loadcommit", sync);
    element.addEventListener("resourcenavigation", sync);
    element.addEventListener("loadstop", sync);
    for (const type of ["navigation", "open", "popup", "newwindow"])
      element.addEventListener(type, open);
    channel.onmessage = ({ data }) => {
      if (data?.type === "cancel") closeEmptyWindow();
    };
    const receive = async (event: MessageEvent) => {
      const data = event.data;
      if (
        event.origin !== location.origin ||
        data?.type !== "attach-explorer" ||
        data.session !== channelId
      )
        return;
      const reply = event.ports[0];
      if (!reply) return;
      if (attaching || attached || disposed) {
        reply.postMessage(
          { type: "error", error: "Explorer receiver is unavailable", handle: data.handle },
          [data.handle],
        );
        reply.close();
        return;
      }
      attaching = true;
      let removePreview = () => {};
      try {
        removePreview = await showExplorerTransferPreview(element, String(data.preview || ""));
        if (data.agent?.partition) element.partition = data.agent.partition;
        await element.attach(data.handle);
        attached = true;
        if (data.agent && event.ports[1]) {
          agent = receiveBrowserAgent?.(event.ports[1], data.agent, element, () => {
            void windowApi().then((api) => api.close());
          });
          if (!agent) throw new Error("Agent browser controller is unavailable");
          setAgentId(agent.attemptId);
          if (agentControls.current)
            removeControls = installAgentBrowserControls?.(agentControls.current, agent, i18n.t);
        }
        clearTimeout(timer);
        // Acknowledge ownership before waiting for the compositor.
        reply.postMessage({ type: "attached" });
        sync();
        element.focus({ preventScroll: true });
        await waitForExplorerPaint(element);
      } catch (failure) {
        if (!attached) {
          reply.postMessage({ type: "error", error: String(failure), handle: data.handle }, [
            data.handle,
          ]);
        }
        if (!disposed) setError(String(failure));
      } finally {
        reply.close();
        removePreview();
        attaching = false;
        if (expired) closeEmptyWindow();
      }
    };
    const closing = () => agent?.close();
    window.addEventListener("pagehide", closing);
    window.addEventListener("message", receive);
    channel.postMessage({ type: "ready" });
    return () => {
      agent?.close();
      removeControls?.();
      window.removeEventListener("pagehide", closing);
      removeResources();
      disposed = true;
      clearTimeout(timer);
      channel.close();
      window.removeEventListener("message", receive);
      element.remove();
      explorer.current = null;
    };
  }, []);
  return (
    <main className="flex h-dvh flex-col bg-(--background)" data-agent-browser={agentId}>
      <div
        ref={agentControls}
        className={agentId ? "flex h-7 shrink-0 items-center px-2" : "hidden"}
      />
      <nav className="flex h-9 shrink-0 items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("browser.back")}
          disabled={!navigation.canGoBack}
          onClick={() => go(-1)}
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("browser.forward")}
          disabled={!navigation.canGoForward}
          onClick={() => go(1)}
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("browser.reload")}
          onClick={() => void explorer.current?.reload()}
        >
          <RotateCw size={14} />
        </Button>
        {navigation.url.startsWith("file://") ? (
          <FileBreadcrumbs
            address={navigation.url}
            loadDirectory={listLocalDirectory}
            onNavigate={navigate}
          />
        ) : (
          <span className="truncate text-xs">{navigation.url}</span>
        )}
      </nav>
      {error && <p role="alert">{error}</p>}
      <div ref={host} className={`min-h-0 flex-1${agentId ? " ovule-control-viewport" : ""}`} />
    </main>
  );
}
