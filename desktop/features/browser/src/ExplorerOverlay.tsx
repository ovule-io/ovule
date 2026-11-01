import shellTokens from "@ovule/shell/shell.token";
import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Tooltip } from "@ovule/ui/tooltip";
import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import { FileBreadcrumbs } from "./FileBreadcrumbs";
import {
  SquareArrowOutDownLeft,
  ArrowLeft,
  ArrowRight,
  Columns2,
  AppWindow,
  Link,
  RotateCw,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";

import { useTranslation } from "react-i18next";

import { useService } from "@ovule/ioc/react";
import { Button } from "@ovule/ui/button";
import type { LiveExplorerRequest } from "@ovule/framework/overlay/main-overlay";
import type {
  ExplorerElement,
  ExplorerOpenRequest,
  ExplorerNavigationState,
} from "@ovule/shell/explorer";

import {
  captureExplorerTransferPreview,
  detachExplorerWhenReady,
  isExplorerNotAttached,
  beginExplorerOverlayExit,
  showExplorerTransferPreview,
  waitForExplorerPaint,
  waitForExplorerTarget,
  openExplorerWindow,
  recoverExplorerTransfer,
  requireExplorerTransfer,
} from "./explorer-transfer";

import styles from "./ExplorerOverlay.module.css";
import { installExplorerEscape } from "./explorer-escape";

type ExplorerOverlayDependencies = {
  overlays: ServiceOf<typeof frameworkTokens.mainOverlay>;
  workbench: ServiceOf<typeof panesTokens.panes>;
  layout: ServiceOf<typeof frameworkTokens.frameworkLayout>;
};

function ExplorerOverlayContent({
  dependencies,
  props,
}: {
  dependencies: ExplorerOverlayDependencies;
  props: {
    request: LiveExplorerRequest;
    fallbackThreadId?: string;
    fallbackDraftId?: string;
    sidebarAvailable?: boolean;
  };
}) {
  const useShellForTransfer = useService(shellTokens.shell);
  const { DownloadsButton } = useService(shellTokens.routeRuntime);
  const {
    installExplorerResources,
    loadExplorer,
    localExplorerAddress,
    listLocalDirectory,
    installAgentBrowserControls,
    explorerOpenDestination,
    openPopupWindow,
    surfaceUrl,
    copyText,
  } = useService(shellTokens.shell);

  const i18n = useTranslation().i18n;

  const { overlays, workbench, layout } = dependencies;
  const { request, fallbackThreadId, fallbackDraftId, sidebarAvailable = false } = props;

  const { t } = useTranslation();
  const [surfaceRoot, setSurfaceRoot] = useState<HTMLElement | null>(null);
  // app-shell creates a stacking context via backdrop-filter. A body portal
  // would put docked surfaces above drawers inside that context.
  useLayoutEffect(() => {
    setSurfaceRoot(document.querySelector<HTMLElement>(".app-shell") ?? document.body);
  }, []);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const selectedTarget = request.target;
  const pendingAddress = useRef<string | undefined>(undefined);
  const explorer = useRef<ExplorerElement | null>(null);
  const escapeBinding = useRef<ReturnType<typeof installExplorerEscape> | null>(null);
  const agentControls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (request.agent && agentControls.current)
      return installAgentBrowserControls?.(agentControls.current, request.agent, t);
  }, [request.agent, t, installAgentBrowserControls, surfaceRoot]);
  useEffect(() => {
    explorer.current?.setAttribute("aria-label", t("browser.overlayTitle"));
  }, [t]);
  const currentUrl = useRef(request.target);
  const [metadata, setMetadata] = useState({
    url: request.target,
    title: "",
    canGoBack: false,
    canGoForward: false,
  });
  const [failed, setFailed] = useState(false);
  const [movingTo, setMovingTo] = useState<"thread" | "workbench" | "window" | null>(null);
  const moving = movingTo !== null;
  const transferInProgress = useRef(false);
  const [transferError, setTransferError] = useState("");
  const reportTransferError = (error: unknown) => {
    setTransferError(
      error instanceof DOMException && error.name === "NotSupportedError"
        ? t("browser.transferUnsupported")
        : String(error),
    );
    console.error(error);
  };
  const threadId = request.threadId || fallbackThreadId;
  const draftId = !threadId ? fallbackDraftId : undefined;
  const canOpenInSidebar =
    sidebarAvailable &&
    Boolean(threadId || draftId) &&
    (!threadId || threadId === fallbackThreadId);

  const actionRail = useRef<HTMLDivElement>(null);
  const handedOff = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    actionRail.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && !transferInProgress.current) {
        if (document.querySelector("[data-file-picker-popover]")) return;
        event.preventDefault();
        overlays.closeExplorer();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      if (!handedOff.current && previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [overlays, surfaceRoot]);

  useEffect(() => {
    if (!host) return;
    const element = document.createElement("explorer") as ExplorerElement;
    element.setAttribute("isolated", "");
    element.className = styles.explorer;
    // Links and redirects within the preview continue in this overlay.
    element.behavior = `navigation: ${request.navigation === "allow" ? "browser" : "delegate"};`;
    element.behavior += " dialog: delegate;";
    element.contextMenuEnabled = true;
    element.setAttribute("aria-label", i18n.t("browser.overlayTitle"));
    if (request.agent) element.partition = request.agent.partition;
    else loadExplorer(element, selectedTarget, true);
    currentUrl.current = selectedTarget;
    setMetadata({
      url: selectedTarget,
      title: "",
      canGoBack: false,
      canGoForward: false,
    });
    setFailed(false);
    setTransferError("");
    let disposed = false;
    pendingAddress.current = selectedTarget.startsWith("file:") ? selectedTarget : undefined;
    const acceptMetadata = (state: Partial<ExplorerNavigationState>) => {
      if (disposed || element.dataset.previewPending === "true") return;
      if (state.url) state = { ...state, url: localExplorerAddress(state.url) };
      if (
        state.url === "about:blank" ||
        (state.url && pendingAddress.current && state.url !== pendingAddress.current)
      )
        return;
      if (state.url) {
        pendingAddress.current = undefined;
        currentUrl.current = state.url;
      }
      setMetadata((previous) => ({ ...previous, ...state }));
    };
    let metadataRevision = 0;
    const syncMetadata = (event: Event) => {
      if (disposed || transferInProgress.current) return;
      const revision = ++metadataRevision;
      const detail = (event as CustomEvent<Partial<ExplorerNavigationState>>).detail;
      if (detail) acceptMetadata(detail);
      if (typeof element.getNavigationState === "function")
        void element
          .getNavigationState()
          .then((state) => {
            if (!transferInProgress.current && revision === metadataRevision) acceptMetadata(state);
          })
          .catch((error) => {
            if (
              !disposed &&
              !transferInProgress.current &&
              revision === metadataRevision &&
              !isExplorerNotAttached(error)
            )
              console.error(error);
          });
    };
    const loaded = (event: Event) => {
      setFailed(false);
      syncMetadata(event);
    };
    const error = () => setFailed(true);
    let lastOpen: { url: string; at: number } | undefined;
    const open = (event: Event) => {
      const reported = (event as CustomEvent<ExplorerOpenRequest>).detail?.url;
      const target = reported ? localExplorerAddress(reported) : undefined;
      if (!target || !/^(?:https?|file):\/\//i.test(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = explorerOpenDestination(event.type, {
        ...(event as CustomEvent<ExplorerOpenRequest>).detail,
        url: target,
      });
      if (destination === "ignore") return;
      if (destination === "current") {
        loadExplorer(element, target);
        return;
      }
      const now = performance.now();
      if (lastOpen?.url === target && now - lastOpen.at < 1000) return;
      lastOpen = { url: target, at: now };
      if (destination === "popup") {
        void openPopupWindow(target).catch((error) => {
          console.error(error);
          loadExplorer(element, target);
        });
      } else loadExplorer(element, target);
    };
    element.addEventListener("loadcommit", syncMetadata);
    element.addEventListener("resourcenavigation", syncMetadata);
    element.addEventListener("loadstop", loaded);
    element.addEventListener("loaderror", error);
    element.addEventListener("error", error);
    for (const type of ["navigation", "open", "popup", "newwindow"])
      element.addEventListener(type, open);
    const removeEscape = installExplorerEscape(element, () => {
      if (!transferInProgress.current && overlays.current().explorer === request)
        overlays.closeExplorer();
    });
    escapeBinding.current = removeEscape;
    host.replaceChildren(element);
    const removeResources = installExplorerResources?.(element, t) ?? (() => {});
    const removeAgent = request.agent?.bind(element, () => {
      if (overlays.current().explorer === request) overlays.closeExplorer();
    });
    explorer.current = element;
    return () => {
      removeEscape();
      if (escapeBinding.current === removeEscape) escapeBinding.current = null;
      removeAgent?.();
      removeResources();
      disposed = true;
      element.removeEventListener("loadcommit", syncMetadata);
      element.removeEventListener("resourcenavigation", syncMetadata);
      element.removeEventListener("loadstop", loaded);
      element.removeEventListener("loaderror", error);
      element.removeEventListener("error", error);
      for (const type of ["navigation", "open", "popup", "newwindow"])
        element.removeEventListener(type, open);
      element.remove();
      if (explorer.current === element) explorer.current = null;
    };
  }, [host, request, overlays, workbench, selectedTarget]);

  const promote = async (placement: "thread" | "workbench") => {
    const source = explorer.current;
    if (transferInProgress.current || !source || (placement === "thread" && !canOpenInSidebar))
      return;
    transferInProgress.current = true;
    setMovingTo(placement);
    setTransferError("");
    let newTabId: string | undefined;
    let removeSourcePreview: (() => void) | undefined;
    let removeTargetPreview: (() => void) | undefined;
    let transfer: Awaited<ReturnType<ExplorerElement["detach"]>> | undefined;
    let exit: ReturnType<typeof beginExplorerOverlayExit> | undefined;
    try {
      await request.agent?.beginTransfer();
      requireExplorerTransfer(source);
      const previewReady = captureExplorerTransferPreview(source);
      if (overlays.current().explorer !== request) return;
      const preview = await previewReady;
      removeSourcePreview = await showExplorerTransferPreview(source, preview);
      // Activating a pane changes the surrounding thread layout. Take ownership
      // before that update so the source cannot be detached by a DOM remount.
      await escapeBinding.current?.pause();
      const detached = await detachExplorerWhenReady(source, {
        isCurrent: () => overlays.current().explorer === request && explorer.current === source,
      });
      transfer = detached.transfer;
      const state = detached.state;
      const targetUrl =
        state.url && state.url !== "about:blank"
          ? localExplorerAddress(state.url)
          : currentUrl.current;
      newTabId = workbench.openTab("browser", {
        placement,
        threadId,
        draftId,
        newInstance: true,
        target: targetUrl,
        autoLoad: false,
        reuseExistingTarget: false,
      });
      // Register before React mounts the tab, so it creates an empty receiver.
      overlays.promoteExplorer(newTabId);
      workbench.updateTab(newTabId, {
        title: state.title || metadata.title || currentUrl.current,
        url: targetUrl,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      });
      if (placement === "thread") layout.setSidebarOpen(true);
      else layout.openWorkbench();
      const target = await waitForExplorerTarget(newTabId);
      if (overlays.current().explorer !== request || explorer.current !== source) {
        throw new Error(i18n.t("browser.explorerPreviewWasClosedDuringTransfer"));
      }
      removeTargetPreview = await showExplorerTransferPreview(target, preview);
      // Keep OAuth redirect behavior when moving the live page into a pane.
      // Security and partition compatibility are checked independently.
      target.behavior = source.behavior;
      exit = beginExplorerOverlayExit(source);
      await target.attach(transfer);
      delete target.dataset.explorerTransferTarget;
      // Ownership has moved: reveal the destination immediately. Its preview
      // remains until the compositor (or PDF viewer) has painted the page.
      await exit.finished;
      handedOff.current = true;
      if (overlays.current().explorer === request) overlays.closeExplorer();
      target.focus({ preventScroll: true });
      await waitForExplorerPaint(target);
    } catch (error) {
      exit?.cancel();
      let committed = false;
      try {
        if (transfer) committed = await recoverExplorerTransfer(source, transfer);
      } catch (recoveryError) {
        console.error(recoveryError);
      } finally {
        if (committed) {
          handedOff.current = true;
          if (overlays.current().explorer === request) overlays.closeExplorer();
        } else if (newTabId) {
          workbench.closeTab(newTabId);
          overlays.releaseExplorerTab(newTabId);
        }
      }
      if (!committed) request.agent?.activate(source);
      reportTransferError(error);
    } finally {
      request.agent?.finishTransfer();
      removeSourcePreview?.();
      removeTargetPreview?.();
      transferInProgress.current = false;
      if (overlays.current().explorer === request) escapeBinding.current?.resume();
      setMovingTo(null);
    }
  };

  const independent = async () => {
    const source = explorer.current;
    if (transferInProgress.current || !source) return;
    transferInProgress.current = true;
    setMovingTo("window");
    setTransferError("");
    let exit: ReturnType<typeof beginExplorerOverlayExit> | undefined;
    try {
      await request.agent?.beginTransfer();
      await escapeBinding.current?.pause();
      await openExplorerWindow(
        source,
        surfaceUrl("/explorer", {
          theme: document.documentElement.dataset.theme,
          language: document.documentElement.lang,
        }),
        useShellForTransfer,
        () => {
          exit = beginExplorerOverlayExit(source);
        },
        request.agent,
      );
      await exit?.finished;
      handedOff.current = true;
      if (overlays.current().explorer === request) overlays.closeExplorer();
    } catch (error) {
      exit?.cancel();
      reportTransferError(error);
    } finally {
      request.agent?.finishTransfer();
      transferInProgress.current = false;
      if (overlays.current().explorer === request) escapeBinding.current?.resume();
      setMovingTo(null);
    }
  };

  if (!surfaceRoot) return null;
  return createPortal(
    <>
      {
        <div
          className={styles.backdrop}
          data-explorer-backdrop
          onClick={() => {
            if (!moving) overlays.closeExplorer();
          }}
          aria-hidden="true"
        />
      }
      <section
        key="live-surface"
        className={styles.content}
        role="dialog"
        aria-modal={true}
        aria-busy={moving}
        aria-label={metadata.title || t("browser.overlayTitle")}
        data-explorer-preview={request.id}
        data-agent-browser={request.agent?.attemptId}
      >
        <div className={styles.panel} data-explorer-panel>
          <div className={styles.toolbar}>
            <FeedbackButton
              className={styles.toolbarButton}
              variant="ghost"
              size="icon"
              label={t("browser.back")}
              disabled={moving || !metadata.canGoBack}
              action={() => {
                pendingAddress.current = undefined;
                return explorer.current?.back();
              }}
            >
              <ArrowLeft size={13} />
            </FeedbackButton>
            <FeedbackButton
              className={styles.toolbarButton}
              variant="ghost"
              size="icon"
              label={t("browser.forward")}
              disabled={moving || !metadata.canGoForward}
              action={() => {
                pendingAddress.current = undefined;
                return explorer.current?.forward();
              }}
            >
              <ArrowRight size={13} />
            </FeedbackButton>
            <FeedbackButton
              className={styles.toolbarButton}
              variant="ghost"
              size="icon"
              label={t("browser.reload")}
              disabled={moving}
              action={() => explorer.current?.reload()}
            >
              <RotateCw size={13} />
            </FeedbackButton>
            <div className={styles.addressGroup}>
              <FeedbackButton
                className={styles.toolbarButton}
                variant="ghost"
                size="icon"
                label={t("browser.copyUrl")}
                successLabel={t("common.copied")}
                action={() => copyText(currentUrl.current)}
              >
                <Link size={13} />
              </FeedbackButton>
              {metadata.url.startsWith("file://") ? (
                <FileBreadcrumbs
                  address={metadata.url}
                  loadDirectory={listLocalDirectory}
                  onNavigate={(url) => {
                    if (!moving && explorer.current) {
                      pendingAddress.current = url;
                      currentUrl.current = url;
                      loadExplorer(explorer.current, url);
                    }
                  }}
                />
              ) : (
                <span className={styles.address} title={metadata.url}>
                  {metadata.url.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                </span>
              )}
            </div>
            <div ref={agentControls} />
          </div>
          <div key="viewport" className={styles.surface}>
            <div ref={setHost} className={styles.host} />
            {transferError && (
              <div className={styles.error} role="alert">
                {transferError}
              </div>
            )}
            {failed && (
              <div className={styles.error} role="alert">
                {t("browser.failed")}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFailed(false);
                    void explorer.current?.reload();
                  }}
                >
                  {t("browser.reload")}
                </Button>
              </div>
            )}
          </div>
        </div>
        <div ref={actionRail} className={styles.actions}>
          <Tooltip side="right" content={t("browser.overlayClose")}>
            <Button
              variant="ghost"
              size="icon"
              className={styles.actionButton}
              aria-label={t("browser.overlayClose")}
              disabled={moving}
              onClick={() => {
                if (!moving) overlays.closeExplorer();
              }}
            >
              <X size={16} />
            </Button>
          </Tooltip>
          <Tooltip side="right" content={t("browser.openInSidebar")}>
            <Button
              variant="ghost"
              size="icon"
              className={styles.actionButton}
              aria-label={t("browser.openInSidebar")}
              disabled={moving || !canOpenInSidebar}
              onClick={() => void promote("thread")}
            >
              {movingTo === "thread" ? (
                <LoaderCircle size={16} className={styles.spinner} />
              ) : (
                <SquareArrowOutDownLeft size={16} />
              )}
            </Button>
          </Tooltip>
          <Tooltip side="right" content={t("browser.openInWorkbench")}>
            <Button
              variant="ghost"
              size="icon"
              className={styles.actionButton}
              aria-label={t("browser.openInWorkbench")}
              disabled={moving}
              onClick={() => void promote("workbench")}
            >
              {movingTo === "workbench" ? (
                <LoaderCircle size={16} className={styles.spinner} />
              ) : (
                <Columns2 size={16} />
              )}
            </Button>
          </Tooltip>
          <Tooltip side="right" content={t("browser.openInIndependentWindow")}>
            <Button
              variant="ghost"
              size="icon"
              className={styles.actionButton}
              aria-label={t("browser.openInIndependentWindow")}
              disabled={moving}
              onClick={() => void independent()}
            >
              {movingTo === "window" ? (
                <LoaderCircle size={16} className={styles.spinner} />
              ) : (
                <AppWindow size={16} />
              )}
            </Button>
          </Tooltip>
          <DownloadsButton className={styles.actionButton} side="left" />
        </div>
      </section>
    </>,
    surfaceRoot,
  );
}

export const ExplorerOverlayFactory = create((dependsOn) => {
  const overlays = dependsOn(frameworkTokens.mainOverlay);
  const workbench = dependsOn(panesTokens.panes);
  const layout = dependsOn(frameworkTokens.frameworkLayout);
  const dependencies = { overlays, workbench, layout };
  return function ExplorerOverlay(props: {
    request: LiveExplorerRequest;
    fallbackThreadId?: string;
    fallbackDraftId?: string;
    sidebarAvailable?: boolean;
  }) {
    return createElement(ExplorerOverlayContent, { dependencies, props });
  };
}, "ExplorerOverlay");

export const ExplorerOverlay = (...args: Parameters<ServiceOf<typeof ExplorerOverlayFactory>>) =>
  createElement(useService(ExplorerOverlayFactory), ...args);
