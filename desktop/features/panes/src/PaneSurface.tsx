import shellTokens from "@ovule/shell/shell.token";
import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCw } from "lucide-react";
import type { ExplorerElement, ExplorerDialog, ExplorerOpenRequest } from "@ovule/shell/explorer";

import type { PaneInstance } from "./tab";
import { useService } from "@ovule/ioc/react";

import { browserSurfaceMode } from "./browserSurfaceMode";

type PaneSurfaceDependencies = {
  workbench: ServiceOf<typeof panesTokens.panes>;
  overlays: ServiceOf<typeof frameworkTokens.mainOverlay>;
};

function PaneSurfaceContent({
  dependencies,
  props,
}: {
  dependencies: PaneSurfaceDependencies;
  props: {
    tab: PaneInstance;
    active: boolean;
    style?: CSSProperties;
  };
}) {
  const {
    installExplorerResources,
    installAgentBrowserControls,
    explorerOpenDestination,
    resolveBrowserTarget,
    loadExplorer,
    htmlPreviewSource,
    localExplorerAddress,
    surfaceUrl,
    openPopupWindow,
  } = useService(shellTokens.shell);

  const browserAddress = (value?: string) =>
    value && tab.threadId && !/^[a-z][a-z0-9+.-]*:|^[\/]/i.test(value) && /\.html?$/i.test(value)
      ? htmlPreviewSource(tab.threadId, value)
      : resolveBrowserTarget(value);

  const i18n = useTranslation().i18n;

  const { workbench, overlays } = dependencies;
  const { tab, active, style } = props;
  const pendingAddress = useRef<string | undefined>(undefined);
  const pendingPreviewMode = useRef<boolean | undefined>(undefined);

  useTranslation();
  const [initialized, setInitialized] = useState(active && Boolean(style));
  useLayoutEffect(() => {
    if (active && style) setInitialized(true);
  }, [active, style]);
  const agent = useRef(overlays.current().explorerTabs[tab.id]?.agent).current;
  const agentControls = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const explorer = useRef<ExplorerElement | null>(null);
  const appliedRequest = useRef(tab.requestVersion);
  const metadataRevision = useRef(0);
  const [failed, setFailed] = useState(false);
  const latest = useRef(tab);
  latest.current = tab;
  const visible = active && Boolean(style);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const initialBrowserMode = useRef(browserSurfaceMode(tab)).current;
  const directBrowser = initialBrowserMode === "direct";
  const surfaceStyle: CSSProperties =
    active && style
      ? style
      : style
        ? {
            ...style,
            left: -100_000,
            pointerEvents: "none",
          }
        : {
            position: "absolute",
            left: -100_000,
            top: 0,
            width: 1,
            height: 1,
            pointerEvents: "none",
          };
  useLayoutEffect(() => {
    if (!visible || directBrowser) return;
    const element = explorer.current;
    if (!element || tab.kind !== "browser" || tab.target || tab.url) return;
    element.focus({ preventScroll: true });
    element.postMessage?.({ type: "pane.command", action: "browser.focusAddress" });
  }, [visible, directBrowser, tab.kind, tab.target, tab.url]);
  useEffect(() => {
    if (!initialized) return;
    // The marker describes an initial receiver, not the tab's whole lifetime.
    // Read it at creation; releasing it after attach must not recreate the page.
    const receivingTransfer = Boolean(overlays.current().explorerTabs[tab.id]);
    const element = document.createElement("explorer") as ExplorerElement;
    const initialAddress = tab.url ?? tab.target;
    if (directBrowser) {
      const address = localExplorerAddress(browserAddress(initialAddress));
      pendingAddress.current =
        address.startsWith("file:") || address.startsWith("ovule://-/preview-html?")
          ? address
          : undefined;
    }
    let disposed = false;
    // The initial source already represents the saved location. A persisted
    // request counter is not a new instruction to revisit the original target.
    appliedRequest.current = tab.requestVersion;
    metadataRevision.current++;
    if (directBrowser) element.setAttribute("isolated", "");
    if (agent) element.partition = agent.partition;
    element.className = "tool-explorer block h-full min-h-0 w-full min-w-0 border-0";
    element.behavior = `navigation: ${tab.navigation === "allow" ? "browser" : "delegate"};`;
    element.behavior += " dialog: delegate;";
    element.contextMenuEnabled = true;
    element.setAttribute("aria-label", tab.title);
    if (!receivingTransfer) {
      if (directBrowser) loadExplorer(element, browserAddress(initialAddress), true);
      else
        element.src = surfaceUrl("/pane", {
          kind: tab.kind,
          tab: tab.id,
          thread: tab.threadId ?? "",
          workspaceBinding: tab.workspaceBindingId,
          shellProfile: tab.shellProfileId,
          useThreadWorkspace: tab.useThreadWorkspace ? "true" : undefined,
          target: tab.target,
          theme: document.documentElement.dataset.theme,
          language: document.documentElement.lang,
        });
    }
    const error = () => setFailed(true);
    const syncBrowserMetadata = (event?: Event) => {
      if (
        element.dataset.previewPending === "true" ||
        !directBrowser ||
        typeof element.getNavigationState !== "function"
      )
        return;
      const revision = ++metadataRevision.current;
      const requestVersion = latest.current.requestVersion;
      const detail = (
        event as
          | CustomEvent<
              Partial<{
                title: string;
                url: string;
                canGoBack: boolean;
                canGoForward: boolean;
              }>
            >
          | undefined
      )?.detail;
      if (detail) {
        const address =
          typeof detail.url === "string" ? localExplorerAddress(detail.url) : undefined;
        if (address === "about:blank") return;
        if (address && pendingAddress.current && address !== pendingAddress.current) return;
        if (address && address !== "about:blank") {
          pendingAddress.current = undefined;
        }
        workbench.updateTab(tab.id, {
          ...(typeof detail.title === "string" && detail.title ? { title: detail.title } : {}),
          ...(typeof detail.url === "string" ? { url: localExplorerAddress(detail.url) } : {}),
          ...(typeof detail.canGoBack === "boolean" ? { canGoBack: detail.canGoBack } : {}),
          ...(typeof detail.canGoForward === "boolean"
            ? { canGoForward: detail.canGoForward }
            : {}),
        });
      }
      void element
        .getNavigationState()
        .then((state) => {
          if (
            disposed ||
            revision !== metadataRevision.current ||
            requestVersion !==
              workbench.current().instances.find((entry) => entry.id === tab.id)?.requestVersion
          )
            return;
          const rendered = new URL(state.url);
          const source = rendered.searchParams.get("mode") === "source";
          if (pendingPreviewMode.current !== undefined && source !== pendingPreviewMode.current)
            return;
          pendingPreviewMode.current = undefined;
          const address = localExplorerAddress(state.url);
          if (pendingAddress.current && address !== pendingAddress.current) return;
          if (address !== "about:blank") {
            pendingAddress.current = undefined;
          }
          workbench.updateTab(tab.id, {
            title: state.title || state.url || latest.current.title,
            url: localExplorerAddress(state.url),
            canGoBack: state.canGoBack,
            canGoForward: state.canGoForward,
            toolbarState: {
              ...latest.current.toolbarState,
              source: String(source),
            },
          });
        })
        .catch(console.error);
    };
    const focusAddress = () => {
      const current = latest.current;
      if (
        !visibleRef.current ||
        directBrowser ||
        current.kind !== "browser" ||
        current.target ||
        current.url
      )
        return;
      element.focus({ preventScroll: true });
      element.postMessage?.({ type: "pane.command", action: "browser.focusAddress" });
    };
    const loaded = () => {
      setFailed(false);
      focusAddress();
      if (directBrowser) syncBrowserMetadata();
      if (!directBrowser || localExplorerAddress(element.src).startsWith("file:")) syncAppearance();
    };
    const attached = () => {
      overlays.releaseExplorerTab(tab.id);
      loaded();
    };
    let lastOpenRequest: { url: string; at: number } | undefined;
    const open = (event: Event) => {
      const reported = (event as CustomEvent<ExplorerOpenRequest>).detail;
      const request = reported
        ? { ...reported, url: localExplorerAddress(reported.url) }
        : undefined;
      if (!request?.url) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = explorerOpenDestination(event.type, request);
      if (destination === "ignore") return;
      if (destination === "current") {
        loadExplorer(element, request.url);
        return;
      }
      const now = performance.now();
      if (lastOpenRequest?.url === request.url && now - lastOpenRequest.at < 1_000) return;
      lastOpenRequest = { url: request.url, at: now };
      if (destination === "popup") {
        void openPopupWindow(request.url).catch((error) => {
          console.error(error);
          workbench.openTab("browser", {
            newInstance: true,
            threadId: latest.current.threadId,
            draftId: latest.current.draftId,
            placement: latest.current.placement,
            target: request.url,
            autoLoad: true,
          });
        });
        return;
      }
      window.dispatchEvent(
        new CustomEvent("ovule:browser-use", {
          detail: {
            target: request.url,
            threadId: latest.current.threadId,
          },
        }),
      );
    };
    const dialog = async (event: Event) => {
      const request = (event as CustomEvent<ExplorerDialog>).detail;
      if (!request) return;
      if (request.type === "alert") {
        window.alert(request.message);
        await request.accept();
      } else if (request.type === "prompt") {
        const answer = window.prompt(request.message, request.defaultValue);
        await (answer === null ? request.dismiss() : request.accept(answer));
      } else await (window.confirm(request.message) ? request.accept() : request.dismiss());
    };
    const syncAppearance = () => {
      void element.postMessage?.({
        type: "appearance.sync",
        threadId: latest.current.threadId ?? "",
        theme: document.documentElement.dataset.theme,
        language: document.documentElement.lang,
      });
    };
    const ready = (event: Event) => {
      if ((event as CustomEvent).detail === tab.id) focusAddress();
      if (
        (event as CustomEvent).detail === tab.id &&
        latest.current.target &&
        latest.current.requestVersion !== tab.requestVersion
      )
        element.postMessage({ type: "tab.navigate", target: latest.current.target });
    };
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string; action?: string }>).detail;
      if (detail?.tabId === tab.id && detail.action) {
        if (directBrowser) {
          if (detail.action.startsWith("browser.navigate:")) {
            pendingPreviewMode.current = undefined;
            workbench.updateTab(tab.id, {
              target: detail.action.slice("browser.navigate:".length),
              url: undefined,
              requestVersion: latest.current.requestVersion + 1,
            });
            return;
          }
          if (detail.action === "browser.toggleSource") {
            const address = localExplorerAddress(latest.current.url ?? latest.current.target ?? "");
            if (!/^file:.*\.(?:md|markdown|mdown|html?|svg)(?:[?#].*)?$/i.test(address)) return;
            const source = element.dataset.previewMode !== "source";
            pendingPreviewMode.current = source;
            element.dataset.previewMode = source ? "source" : "preview";
            workbench.updateTab(tab.id, {
              toolbarState: { ...latest.current.toolbarState, source: String(source) },
            });
            loadExplorer(element, address);
            return;
          }
          if (detail.action === "browser.back" || detail.action === "browser.forward") {
            pendingAddress.current = undefined;
            pendingPreviewMode.current = undefined;
          }
          const operation =
            detail.action === "browser.back"
              ? element.back?.()
              : detail.action === "browser.forward"
                ? element.forward?.()
                : detail.action === "browser.reload"
                  ? element.reload?.()
                  : undefined;
          void operation?.then(() => syncBrowserMetadata()).catch(console.error);
        } else {
          void element.postMessage?.({
            type: "pane.command",
            action: detail.action,
          });
        }
      }
    };
    if (!directBrowser) window.addEventListener("ovule:tab-ready", ready);
    window.addEventListener("ovule:pane-command", command);
    const observer = new MutationObserver(syncAppearance);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "lang"],
    });
    element.addEventListener("attached", attached);
    element.addEventListener("loadstart", syncBrowserMetadata);
    element.addEventListener("loadstop", loaded);
    element.addEventListener("loadcommit", syncBrowserMetadata);
    element.addEventListener("resourcenavigation", syncBrowserMetadata);
    element.addEventListener("titlechange", syncBrowserMetadata);
    element.addEventListener("loaderror", error);
    element.addEventListener("dialog", dialog);
    for (const type of ["navigation", "open", "popup", "newwindow"])
      element.addEventListener(type, open);
    if (receivingTransfer) element.dataset.explorerTransferTarget = tab.id;
    host.current?.replaceChildren(element);
    const removeResources = installExplorerResources?.(element, i18n.t) ?? (() => {});
    const removeAgent = agent?.bind(element, () => workbench.closeTab(tab.id));
    const removeControls =
      agent && agentControls.current
        ? installAgentBrowserControls?.(agentControls.current, agent, i18n.t)
        : undefined;
    explorer.current = element;
    const focusFrame =
      active && style && !directBrowser && tab.kind === "browser" && !tab.target && !tab.url
        ? requestAnimationFrame(focusAddress)
        : undefined;
    return () => {
      disposed = true;
      metadataRevision.current++;
      removeAgent?.();
      removeControls?.();
      removeResources();
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      if (!directBrowser) window.removeEventListener("ovule:tab-ready", ready);
      window.removeEventListener("ovule:pane-command", command);
      observer.disconnect();
      element.removeEventListener("attached", attached);
      element.removeEventListener("loadstart", syncBrowserMetadata);
      element.removeEventListener("loadstop", loaded);
      element.removeEventListener("loadcommit", syncBrowserMetadata);
      element.removeEventListener("resourcenavigation", syncBrowserMetadata);
      element.removeEventListener("titlechange", syncBrowserMetadata);
      element.removeEventListener("loaderror", error);
      element.removeEventListener("dialog", dialog);
      for (const type of ["navigation", "open", "popup", "newwindow"])
        element.removeEventListener(type, open);
      element.remove();
      explorer.current = null;
    };
  }, [
    directBrowser,
    initialized,
    tab.id,
    tab.kind,
    workbench,
    overlays,
    agent,
    installAgentBrowserControls,
  ]);
  useEffect(() => {
    if (directBrowser) return;
    void explorer.current?.postMessage?.({
      type: "appearance.sync",
      threadId: tab.threadId ?? "",
      theme: document.documentElement.dataset.theme,
      language: document.documentElement.lang,
    });
  }, [directBrowser, tab.threadId]);
  useEffect(() => {
    if (appliedRequest.current === tab.requestVersion) return;
    if (!tab.requestVersion || !tab.target) return;
    const element = explorer.current;
    if (!element) return;
    appliedRequest.current = tab.requestVersion;
    metadataRevision.current++;
    if (directBrowser && typeof element.load === "function") {
      const address = localExplorerAddress(tab.target);
      pendingAddress.current = address.startsWith("file:") ? address : undefined;
      pendingPreviewMode.current = undefined;
      element.dataset.previewMode = "preview";
      loadExplorer(element, browserAddress(tab.target));
    } else {
      void element.postMessage?.({ type: "tab.navigate", target: tab.target });
    }
  }, [directBrowser, tab.requestVersion]);
  return (
    <div
      className="tool-surface relative flex flex-col h-full min-h-0 w-full min-w-0 border-0 bg-(--background)"
      data-agent-browser={agent?.attemptId}
      data-tool-surface
      data-tool-tab={tab.id}
      data-placement={tab.placement === "thread" ? "thread" : "workbench"}
      data-active={active && style ? "true" : "false"}
      style={surfaceStyle}
      aria-hidden={!active || !style}
    >
      <div
        ref={agentControls}
        className={
          agent ? "flex h-7 shrink-0 items-center border-b border-(--border) px-2" : "hidden"
        }
      />
      <div
        className={`block flex-1 min-h-0 w-full min-w-0 border-0 bg-(--background)${agent ? " ovule-control-viewport" : ""}`}
        ref={host}
      />
      {failed && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 bg-(--background)"
          role="alert"
        >
          {i18n.t("workbench.couldNotLoadThisPane")}{" "}
          <Button
            variant="ghost"
            size="sm"
            aria-label={i18n.t("workbench.reloadPane")}
            onClick={() => {
              const element = explorer.current;
              if (!element) return;
              setFailed(false);
              if (directBrowser)
                loadExplorer(element, browserAddress(latest.current.url ?? latest.current.target));
              else void element.reload?.();
            }}
          >
            <RotateCw size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

export const PaneSurfaceFactory = create((dependsOn) => {
  const workbench = dependsOn(panesTokens.panes);
  const overlays = dependsOn(frameworkTokens.mainOverlay);
  const NewTabPage = dependsOn.optional(panesTokens.newTabView);
  const dependencies = { workbench, overlays };
  return function PaneSurface(props: {
    tab: PaneInstance;
    active: boolean;
    style?: CSSProperties;
  }) {
    const { tab, active, style } = props;
    if (NewTabPage && tab.kind === "browser" && !tab.target && !tab.url) {
      return (
        <div
          className="tool-surface bg-(--background)"
          data-tool-surface
          data-tool-tab={tab.id}
          data-placement={tab.placement === "thread" ? "thread" : "workbench"}
          aria-hidden={!active || !style}
          data-active={active && style ? "true" : "false"}
          style={active && style ? style : { ...style, display: "none" }}
        >
          <NewTabPage
            tabId={tab.id}
            threadId={tab.threadId}
            active={active && Boolean(style)}
            onNavigate={(target) =>
              workbench.updateTab(tab.id, { target, requestVersion: tab.requestVersion + 1 })
            }
            onOpenAction={(kind) =>
              new Promise((resolve, reject) =>
                window.dispatchEvent(
                  new CustomEvent("ovule:new-tab-action", {
                    detail: { tabId: tab.id, kind, resolve, reject },
                  }),
                ),
              )
            }
          />
        </div>
      );
    }
    return createElement(PaneSurfaceContent, { dependencies, props });
  };
}, "PaneSurface");

export const PaneSurface = (...args: Parameters<ServiceOf<typeof PaneSurfaceFactory>>) =>
  createElement(useService(PaneSurfaceFactory), ...args);
