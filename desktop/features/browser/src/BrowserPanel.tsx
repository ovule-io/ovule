import settingsTokens from "@ovule/settings/settings.token";
import type { NewTabAction } from "@ovule/panes/view";
import shellTokens from "@ovule/shell/shell.token";
import omniboxTokens from "@ovule/omnibox/omnibox.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";

import {
  SquareArrowOutUpRight,
  FileCode2,
  FolderOpen,
  Globe2,
  Search,
  RefreshCw,
  SquareTerminal,
  Workflow,
  MonitorUp,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";

import type { BrowserSuggestion } from "@ovule/shell-api";
import { resolveOmnibox } from "./navigation";
import { useService } from "@ovule/ioc/react";

import { cn } from "@ovule/ui/cn";
import toolStyles from "@ovule/ui/tool-panels.module.css";

import type { ExplorerElement } from "@ovule/shell/explorer";

type ExplorerNavigationState = {
  url?: string;
  errorCode?: number;
  errorDescription?: string;
};

type ExplorerOpenRequest = {
  url?: string;
  userGesture?: boolean;
};

type BrowserPanelDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
  Omnibox: ServiceOf<typeof omniboxTokens.omniboxView>;
  preferences: ServiceOf<typeof settingsTokens.preferences>;
};

function BrowserPanelContent({
  dependencies,
  props,
}: {
  dependencies: BrowserPanelDependencies;
  props: {
    threadId?: string;
    workspacePath?: string;
    initialTarget?: string;
    autoLoad?: boolean;
    requestVersion?: number;
    active?: boolean;
    chrome?: boolean;
    tabId?: string;
    onNavigate?(target: string): void;
    onOpenAction?(kind: NewTabAction): Promise<unknown>;
  };
}) {
  const { explorerOpenDestination } = useService(shellTokens.shell);

  const { shell, Omnibox, preferences } = dependencies;
  const {
    threadId,
    workspacePath,
    initialTarget,
    autoLoad = false,
    requestVersion = 0,
    active = true,
    chrome = !props.onNavigate,
    tabId,
    onNavigate,
    onOpenAction,
  } = props;

  const { t } = useTranslation();
  const translator = useRef(t);
  translator.current = t;
  const [target, setTarget] = useState(initialTarget ?? "");
  const [status, setStatus] = useState(() => t("browser.initial"));
  const [openingAction, setOpeningAction] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [surfaceUrl, setSurfaceUrl] = useState<string>();
  const committedSurfaceUrl = useRef<string | undefined>(undefined);
  const explorer = useRef<ExplorerElement | null>(null);
  const explorerHost = useRef<HTMLDivElement | null>(null);
  const emptyOmnibox = useRef<HTMLInputElement | null>(null);
  const navigationGeneration = useRef(0);
  const pendingLoadedStatus = useRef<string | undefined>(undefined);
  const pendingNavigationStarted = useRef(false);
  const autoLoadedVersion = useRef(0);

  useLayoutEffect(() => {
    if (surfaceUrl || !active) return;
    const focusOmnibox = () => emptyOmnibox.current?.focus({ preventScroll: true });
    focusOmnibox();
    const frame = requestAnimationFrame(focusOmnibox);
    window.addEventListener("focus", focusOmnibox);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", focusOmnibox);
    };
  }, [surfaceUrl, active]);

  const openNewTabAction = async (kind: "files" | "terminal" | "workflow" | "spice") => {
    if (openingAction) return;
    setOpeningAction(true);
    try {
      if (onOpenAction) await onOpenAction(kind);
      else await shell.requestRoot("newTab.open", { tabId, kind });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningAction(false);
    }
  };

  const navigateExplorer = (url: string, loadedStatus?: string) => {
    const generation = ++navigationGeneration.current;
    pendingLoadedStatus.current = loadedStatus;
    pendingNavigationStarted.current = true;
    committedSurfaceUrl.current = url;
    const element = explorer.current;
    if (element && typeof element.load === "function") {
      element.dataset.navigationGeneration = String(generation);
      element.contextMenuEnabled = /^(?:https?|file):\/\//i.test(url);
      shell.loadExplorer(element, url);
    } else {
      setSurfaceUrl(url);
    }
  };

  const navigate = async (value: string, browserUse = false) => {
    const destination = resolveOmnibox(value, preferences.current().searchUrl, {
      enterAddress: t("browser.enterAddress"),
      credentialsUnsupported: t("browser.credentialsUnsupported"),
      unsupportedScheme: t("browser.unsupportedScheme"),
      invalidSearchUrl: t("browser.invalidSearchUrl"),
    });
    if (destination.kind === "url") {
      if (onNavigate) {
        onNavigate(destination.target);
        return;
      }
      setTarget(destination.target);
      const remote = /^https?:\/\//i.test(destination.target);
      setStatus(
        t(
          browserUse
            ? remote
              ? "browser.browserOpeningRemote"
              : "browser.browserOpening"
            : remote
              ? "browser.openingRemote"
              : "browser.opening",
        ),
      );
      navigateExplorer(destination.target, t("browser.ready"));
      // Local file navigations in an inner WebContents can commit without
      // Chromium reporting loadstop/loadcommit to the owner. The Explorer
      // still reports a later loaderror, so show the usable committed state
      // immediately and let an actual failure replace it.
      if (destination.target.startsWith("file:")) {
        // Also retire the previous surface's pending status before React swaps
        // the Explorer element. Otherwise its final loadstop can overwrite the
        // local-file status with the previous preview's label.
        pendingNavigationStarted.current = false;
        pendingLoadedStatus.current = undefined;
        setStatus(t("browser.ready"));
      }
      return;
    }
    if (!threadId) throw new Error(t("browser.selectThread"));
    setStatus(t(browserUse ? "browser.browserOpening" : "browser.opening"));
    const preview = shell.htmlPreviewSource(threadId, destination.target);
    if (onNavigate) {
      onNavigate(preview);
      return;
    }
    navigateExplorer(preview, t("browser.loaded", { source: destination.target }));
  };

  useLayoutEffect(() => {
    const host = explorerHost.current;
    if (!host || !surfaceUrl) return;
    const mountedUrl = committedSurfaceUrl.current ?? surfaceUrl;
    const mountedGeneration = navigationGeneration.current;
    const element = document.createElement("explorer") as ExplorerElement;
    element.setAttribute("isolated", "");
    element.title = translator.current("browser.surface");
    element.className = cn(toolStyles.browserExplorer, toolStyles.loaded);
    element.behavior = "navigation: delegate;";
    element.behavior += " dialog: delegate;";
    element.contextMenuEnabled = /^(?:https?|file):\/\//i.test(mountedUrl);
    element.dataset.navigationGeneration = String(mountedGeneration);
    shell.loadExplorer(element, mountedUrl, true);
    explorer.current = element;
    let metadataRevision = 0;
    const publishNavigationMetadata = (
      fallback?: Partial<{
        title: string;
        url: string;
        canGoBack: boolean;
        canGoForward: boolean;
      }>,
    ) => {
      if (!tabId || element.dataset.previewPending === "true") return;
      const revision = ++metadataRevision;
      const generation = navigationGeneration.current;
      if (fallback)
        void shell.requestRoot("tab.metadata", { tabId, ...fallback }).catch(console.error);
      if (typeof element.getNavigationState === "function")
        void element
          .getNavigationState()
          .then((state) => {
            const address = shell.localExplorerAddress(state.url);
            if (
              revision !== metadataRevision ||
              generation !== navigationGeneration.current ||
              !element.isConnected ||
              address === "about:blank" ||
              (pendingNavigationStarted.current &&
                committedSurfaceUrl.current?.startsWith("file:") &&
                address !== committedSurfaceUrl.current)
            )
              return;
            return shell.requestRoot("tab.metadata", {
              tabId,
              ...state,
              url: shell.localExplorerAddress(state.url),
            });
          })
          .catch(console.error);
    };
    const loading = () => {
      if (Number(element.dataset.navigationGeneration) !== navigationGeneration.current) return;
      pendingNavigationStarted.current = true;
    };
    const loaded = () => {
      if (Number(element.dataset.navigationGeneration) !== navigationGeneration.current) return;
      if (!pendingNavigationStarted.current) return;
      pendingNavigationStarted.current = false;
      setStatus(pendingLoadedStatus.current ?? translator.current("browser.ready"));
      pendingLoadedStatus.current = undefined;
      publishNavigationMetadata();
    };
    const failed = (event: Event) => {
      if (Number(element.dataset.navigationGeneration) !== navigationGeneration.current) return;
      const detail = (event as CustomEvent<ExplorerNavigationState>).detail;
      if (
        detail?.url &&
        committedSurfaceUrl.current &&
        shell.localExplorerAddress(detail.url) !== committedSurfaceUrl.current
      ) {
        return;
      }
      pendingNavigationStarted.current = false;
      pendingLoadedStatus.current = undefined;
      setStatus(
        detail?.errorDescription
          ? translator.current("browser.failedDetail", {
              error: detail.errorDescription,
              code: detail.errorCode ?? "",
            })
          : translator.current("browser.failed"),
      );
    };
    const surfaceError = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) failed(event);
    };
    const committed = (event: Event) => {
      if (Number(element.dataset.navigationGeneration) !== navigationGeneration.current) return;
      const reportedUrl = (event as CustomEvent<ExplorerNavigationState>).detail?.url;
      const committedUrl = reportedUrl ? shell.localExplorerAddress(reportedUrl) : undefined;
      if (!committedUrl || committedUrl === "about:blank") return;
      if (
        pendingNavigationStarted.current &&
        committedSurfaceUrl.current?.startsWith("file:") &&
        committedUrl !== committedSurfaceUrl.current
      )
        return;
      committedSurfaceUrl.current = committedUrl;
      publishNavigationMetadata({
        url: committedUrl,
        ...((event as CustomEvent<{ title?: string }>).detail?.title
          ? { title: (event as CustomEvent<{ title?: string }>).detail?.title }
          : {}),
        ...((event as CustomEvent<{ canGoBack?: boolean }>).detail?.canGoBack !== undefined
          ? {
              canGoBack: (event as CustomEvent<{ canGoBack?: boolean }>).detail?.canGoBack,
            }
          : {}),
        ...((event as CustomEvent<{ canGoForward?: boolean }>).detail?.canGoForward !== undefined
          ? {
              canGoForward: (event as CustomEvent<{ canGoForward?: boolean }>).detail?.canGoForward,
            }
          : {}),
      });
      if (/^(?:https?|file):\/\//i.test(committedUrl)) {
        setTarget(committedUrl);
        // Chromium does not consistently emit DidStopLoading for an initial
        // local-file commit in an inner WebContents. The committed document is
        // nevertheless usable, so do not leave the status on the previous page.
        if (committedUrl.startsWith("file:") && pendingNavigationStarted.current) {
          pendingNavigationStarted.current = false;
          setStatus(pendingLoadedStatus.current ?? translator.current("browser.ready"));
          pendingLoadedStatus.current = undefined;
        }
      }
    };
    let lastOpenRequest: { url: string; at: number } | undefined;
    const openRequested = (event: Event) => {
      const request = (event as CustomEvent<ExplorerOpenRequest>).detail;
      const target = request?.url ? shell.localExplorerAddress(request.url) : undefined;
      if (!target || !/^(?:https?|file):\/\//i.test(target)) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = explorerOpenDestination(event.type, {
        ...request,
        url: target,
      });
      if (destination === "ignore") return;
      if (destination === "current") {
        shell.loadExplorer(element, target);
        return;
      }
      const now = performance.now();
      if (lastOpenRequest?.url === target && now - lastOpenRequest.at < 1_000) return;
      lastOpenRequest = { url: target, at: now };
      if (destination === "popup") {
        void shell.requestRoot("window.openPopup", { target }).catch((error) => {
          console.error(error);
          return shell.requestRoot("workbench.open", {
            kind: "browser",
            target,
            newInstance: true,
            ...(tabId ? { fromTab: tabId } : {}),
          });
        });
        return;
      }
      void shell
        .requestRoot("links.open", {
          target,
          ...(tabId ? { fromTab: tabId } : {}),
        })
        .catch(console.error);
    };
    element.addEventListener("loadstart", loading);
    element.addEventListener("loadstop", loaded);
    element.addEventListener("error", surfaceError);
    element.addEventListener("loaderror", failed);
    element.addEventListener("loadcommit", committed);
    element.addEventListener("resourcenavigation", committed);
    element.addEventListener("titlechange", committed);
    element.addEventListener("navigation", openRequested);
    element.addEventListener("open", openRequested);
    element.addEventListener("popup", openRequested);
    element.addEventListener("newwindow", openRequested);
    host.replaceChildren(element);
    const removeResources =
      shell.installExplorerResources?.(element, translator.current) ?? (() => {});
    if (typeof element.load !== "function") {
      if (pendingLoadedStatus.current) setStatus(pendingLoadedStatus.current);
      pendingLoadedStatus.current = undefined;
    }
    return () => {
      removeResources();
      element.removeEventListener("loadstart", loading);
      element.removeEventListener("loadstop", loaded);
      element.removeEventListener("error", surfaceError);
      element.removeEventListener("loaderror", failed);
      element.removeEventListener("loadcommit", committed);
      element.removeEventListener("resourcenavigation", committed);
      element.removeEventListener("titlechange", committed);
      element.removeEventListener("navigation", openRequested);
      element.removeEventListener("open", openRequested);
      element.removeEventListener("popup", openRequested);
      element.removeEventListener("newwindow", openRequested);
      if (explorer.current === element) explorer.current = null;
      element.remove();
    };
  }, [shell, surfaceUrl, tabId]);

  const load = async () => {
    try {
      await navigate(target);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string; action?: string }>).detail;
      if (!active || (detail?.tabId !== undefined && detail.tabId !== tabId)) return;
      const action = detail?.action;
      const element = explorer.current;
      if (action?.startsWith("browser.navigate:")) {
        void navigate(action.slice("browser.navigate:".length)).catch((error) =>
          setStatus(String(error)),
        );
      } else if (action === "browser.focusAddress" && !surfaceUrl) {
        // HTMLElement.focus() on the outer Explorer does not activate its
        // native WebContents. Ask this guest window to take focus first.
        window.focus();
        emptyOmnibox.current?.focus({ preventScroll: true });
      } else if (action === "browser.reload") {
        if (element?.reload) void element.reload();
        else void load();
      } else if (action === "browser.back" && element?.back) {
        pendingNavigationStarted.current = false;
        void element.back();
      } else if (action === "browser.forward" && element?.forward) {
        pendingNavigationStarted.current = false;
        void element.forward();
      }
    };
    window.addEventListener("ovule:pane-command", command);
    return () => window.removeEventListener("ovule:pane-command", command);
  });

  useEffect(() => {
    if (onNavigate || surfaceUrl || !tabId) return;
    // PaneApp can announce ready before this lazy component has mounted.
    // Announce again after the focus-command listener is actually installed.
    void shell.requestRoot("tab.ready", { tabId }).catch(console.error);
  }, [shell, tabId, surfaceUrl, onNavigate]);

  const acceptSuggestion = async (suggestion: BrowserSuggestion) => {
    setTarget(suggestion.target);
    await navigate(suggestion.target);
  };

  useEffect(() => {
    if (!autoLoad || !initialTarget || autoLoadedVersion.current === requestVersion) return;
    if (!isDirectBrowserTarget(initialTarget) && !threadId && looksLikeWorkspaceHtml(initialTarget))
      return;
    autoLoadedVersion.current = requestVersion;
    setTarget(initialTarget);
    void (async () => {
      try {
        await navigate(initialTarget, true);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [autoLoad, initialTarget, requestVersion, threadId]);

  const chooseHtml = async () => {
    if (choosing) return;
    setChoosing(true);
    try {
      const selected = await (
        await shell.dialog()
      ).openFile({
        title: t("browser.chooseTitle"),
        defaultPath: defaultFileDialogPath(target, workspacePath),
        extensions: [["html", "htm"]],
      });
      if (!selected) return;
      const url = fileUrl(selected);
      setTarget(url);
      setStatus(t("browser.opening"));
      navigateExplorer(url, t("browser.loaded", { source: selected }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosing(false);
    }
  };

  const formatSuggestionTitle = (suggestion: BrowserSuggestion) =>
    t(`browser.suggestion.${suggestion.kind}`, {
      target: suggestion.target,
      defaultValue: suggestion.title,
    });
  const formatSuggestionDetail = (suggestion: BrowserSuggestion) =>
    t(`browser.suggestionDetail.${suggestion.kind}`, {
      defaultValue: suggestion.detail,
    });
  const addressIcon =
    target.startsWith("file:") || looksLikeWorkspaceHtml(target) ? (
      <FileCode2 size={14} />
    ) : (
      <Globe2 size={14} />
    );

  return (
    <div
      className={cn(
        "browser-panel",
        toolStyles.browserPanel,
        !chrome && toolStyles.browserPanelEmbedded,
      )}
    >
      {chrome && (
        <>
          <div className={toolStyles.browserToolbar}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("browser.reload")}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
            </Button>
            <Omnibox
              className={cn("browser-address", toolStyles.browserAddress)}
              inputClassName={toolStyles.browserAddressInput}
              contentClassName={toolStyles.browserSuggestions}
              suggestionClassName={toolStyles.browserSuggestion}
              activeSuggestionClassName={toolStyles.browserSuggestionActive}
              suggestionTitleClassName={toolStyles.browserSuggestionTitle}
              suggestionDetailClassName={toolStyles.browserSuggestionDetail}
              leadingIcon={addressIcon}
              value={target}
              placeholder={t("browser.newTabSearchPlaceholder")}
              ariaLabel={t("browser.address")}
              threadId={threadId}
              debounceMs={80}
              suggestionsId="browser-omnibox-suggestions"
              onValueChange={setTarget}
              onSubmit={() => void load()}
              onAccept={(suggestion) => void acceptSuggestion(suggestion)}
              formatTitle={formatSuggestionTitle}
              formatDetail={formatSuggestionDetail}
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("browser.load")}
              onClick={() => void load()}
            >
              <SquareArrowOutUpRight size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("browser.choose")}
              title={t("browser.choose")}
              disabled={choosing}
              onClick={() => void chooseHtml()}
            >
              <FolderOpen size={14} />
            </Button>
          </div>
          <div className={toolStyles.previewNotice}>
            {workspacePath
              ? isDefaultWorkspace(workspacePath)
                ? t("browser.defaultWorkspace")
                : t("browser.workspace", { path: workspacePath })
              : ""}
            <span>{status}</span>
          </div>
        </>
      )}
      <div className={cn("browser-surface", toolStyles.browserSurface)}>
        {!surfaceUrl && (
          <div className={toolStyles.browserEmpty}>
            <Omnibox
              className={cn("browser-empty-omnibox", toolStyles.browserEmptyOmnibox)}
              inputClassName={toolStyles.browserEmptyInput}
              contentClassName={toolStyles.browserSuggestions}
              suggestionClassName={toolStyles.browserSuggestion}
              activeSuggestionClassName={toolStyles.browserSuggestionActive}
              suggestionTitleClassName={toolStyles.browserSuggestionTitle}
              suggestionDetailClassName={toolStyles.browserSuggestionDetail}
              leadingIcon={<Search />}
              inputRef={emptyOmnibox}
              inputRole="combobox"
              autoFocus={active}
              value={target}
              placeholder={t("browser.newTabSearchPlaceholder")}
              ariaLabel={t("browser.address")}
              threadId={threadId}
              debounceMs={80}
              suggestionsId="browser-empty-omnibox-suggestions"
              onValueChange={setTarget}
              onSubmit={() => void load()}
              onAccept={(suggestion) => void acceptSuggestion(suggestion)}
              formatTitle={formatSuggestionTitle}
              formatDetail={formatSuggestionDetail}
            />
            <nav className={toolStyles.newTabActions} aria-label={t("explorerTitlebar.addTab")}>
              {(
                [
                  ["files", FolderOpen, "harness.localFiles"],
                  ["terminal", SquareTerminal, "harness.terminal"],
                  ["workflow", Workflow, "harness.workflow"],
                  ["spice", MonitorUp, "harness.remoteHost"],
                ] as const
              ).map(([kind, Icon, label]) => (
                <Button
                  key={kind}
                  variant="ghost"
                  disabled={openingAction}
                  onClick={() => void openNewTabAction(kind)}
                >
                  <Icon size={18} />
                  <span>{t(label)}</span>
                </Button>
              ))}
            </nav>
            {status !== t("browser.initial") && <small role="status">{status}</small>}
          </div>
        )}
        <div ref={explorerHost} className={toolStyles.browserExplorerHost} />
      </div>
    </div>
  );
}

export const BrowserPanelFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const Omnibox = dependsOn(omniboxTokens.omniboxView);
  const preferences = dependsOn(settingsTokens.preferences);
  const dependencies = { shell, Omnibox, preferences };
  return function BrowserPanel(props: {
    threadId?: string;
    workspacePath?: string;
    initialTarget?: string;
    autoLoad?: boolean;
    requestVersion?: number;
    active?: boolean;
    chrome?: boolean;
    tabId?: string;
    onNavigate?(target: string): void;
    onOpenAction?(kind: NewTabAction): Promise<unknown>;
  }) {
    return createElement(BrowserPanelContent, { dependencies, props });
  };
}, "BrowserPanel");

export const BrowserPanel = (...args: Parameters<ServiceOf<typeof BrowserPanelFactory>>) =>
  createElement(useService(BrowserPanelFactory), ...args);

function looksLikeWorkspaceHtml(value: string): boolean {
  return /^\.{0,2}[\\/]/.test(value) || /\.html?(?:[?#].*)?$/i.test(value);
}

function isAbsoluteFilePath(value: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value);
}

function fileUrl(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("//")) return new URL(`file:${normalized}`).href;
  return new URL(/^[a-z]:\//i.test(normalized) ? `/${normalized}` : normalized, "file:///").href;
}

function isDirectBrowserTarget(value: string): boolean {
  return /^(?:https?|file):\/\//i.test(value) || isAbsoluteFilePath(value);
}

function defaultFileDialogPath(target: string, workspacePath?: string): string | undefined {
  if (/^file:\/\//i.test(target)) {
    const url = new URL(target);
    const path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
    return url.host ? `\\\\${url.host}${path.replaceAll("/", "\\")}` : path;
  }
  return workspacePath
    ? `${workspacePath.replace(/[\\/]+$/, "")}/${target.replace(/^[\\/]+/, "")}`
    : undefined;
}

function looksLikeHost(value: string): boolean {
  return (
    !/\s/.test(value) &&
    /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[::1\]|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#].*)?$/i.test(
      value,
    )
  );
}

function isDefaultWorkspace(value: string): boolean {
  return /[\\/]Ovule[\\/]data[\\/]workspaces[\\/]default[\\/]?$/i.test(value);
}
