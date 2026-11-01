import workflowTokens from "@ovule/workflow/workflow.token";
import shellTokens from "@ovule/shell/shell.token";
import frameworkTokens from "@ovule/framework/framework.token";
import panesTokens from "@ovule/panes/panes.token";
import type { WorkflowStateService } from "@ovule/workflow/state";
import { threadFamilyOwners } from "./thread-family";
import { isWorkbenchKind } from "./workbench-kind";

import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useTranslation } from "react-i18next";

import { LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@ovule/ui/cn";

import { Button } from "@ovule/ui/button";
import type {
  ExplorerDialog,
  ExplorerElement,
  ExplorerOpenRequest,
  TuffiteMessageEvent,
} from "@ovule/shell/explorer";

import type { MainOverlayService } from "@ovule/framework/overlay/main-overlay";
import type { SnapshotSyncService } from "@ovule/shell/snapshot-sync";
import type { ShellService } from "@ovule/shell/shell";

import type { PanesService } from "@ovule/panes/panes";
import type { FrameworkLayoutService } from "@ovule/framework/framework";
import type { LanguageMode } from "@ovule/i18n/i18n";
import type { ThemeMode } from "@ovule/settings/preferences/preferences";
import type { PaneInstance, PaneKind } from "@ovule/panes/tab";
import { useService } from "@ovule/ioc/react";
import { useObservableState } from "@ovule/ioc/react";

type SurfaceStatus = "loading" | "ready" | "failed";
type RootRequest = {
  type?: unknown;
  requestId?: unknown;
  channel?: unknown;
  payload?: unknown;
};

type ThreadSurfaceDependencies = {
  workflow: WorkflowStateService;
  runtime: ServiceOf<typeof shellTokens.snapshotSync>;
  shell: ServiceOf<typeof shellTokens.shell>;
  workbench: ServiceOf<typeof panesTokens.panes>;
  overlays: ServiceOf<typeof frameworkTokens.mainOverlay>;
  layout: ServiceOf<typeof frameworkTokens.frameworkLayout>;
};

function ThreadSurfaceContent({
  dependencies,
  props,
}: {
  dependencies: ThreadSurfaceDependencies;
  props: {
    threadId?: string;
    theme: ThemeMode;
    languageMode: LanguageMode;
    selectThread(id: string): void;
    className?: string;
  };
}) {
  const { explorerOpenDestination, surfaceUrl, openPopupWindow } = useService(shellTokens.shell);

  const i18n = useTranslation().i18n;

  const { runtime, shell, workbench, overlays, layout } = dependencies;
  const { threadId, theme, languageMode, selectThread, className } = props;

  useTranslation();
  const sidebarOpen = useObservableState(layout, (state) => state.sidebarOpen);
  const workflow = useObservableState(dependencies.workflow, (state) => state.snapshot);
  const draftId = useObservableState(workbench, (state) => state.draftConversationId);
  const owners = threadFamilyOwners(threadId, workflow);
  if (!threadId) owners.add(draftId);
  const threadTabs = useObservableState(workbench, (state) =>
    state.instances.filter(
      (tab) => tab.placement === "thread" && owners.has(tab.threadId ?? tab.draftId),
    ),
  );
  useEffect(() => {
    explorer.current?.setAttribute("aria-label", i18n.t("conversation.thread"));
  }, [i18n.language]);
  const contextRef = useRef({ threadId, draftId, theme, languageMode, sidebarOpen });
  contextRef.current = { threadId, draftId, theme, languageMode, sidebarOpen };
  const threadTabsRef = useRef<PaneInstance[]>(threadTabs);
  threadTabsRef.current = threadTabs;
  const slot = useRef<HTMLDivElement>(null);
  const explorer = useRef<ExplorerElement | null>(null);
  const [status, setStatus] = useState<SurfaceStatus>("loading");
  const [error, setError] = useState<string>();
  const [generation, setGeneration] = useState(0);

  useLayoutEffect(() => {
    const tuffite = shell.messageApi();
    if (!tuffite) return;
    const handle = (event: TuffiteMessageEvent) => {
      if (event.origin !== location.origin || !event.source) return;
      const source = event.source as Window;
      const request = event.data as RootRequest | null;
      if (
        request?.type !== "app-request" ||
        typeof request.requestId !== "string" ||
        typeof request.channel !== "string"
      )
        return;
      void handleRootRequest(
        request.channel,
        request.payload,
        {
          runtime,
          shell,
          workbench,
          layout,
          overlays,
          workflow: dependencies.workflow,
        },
        selectThread,
        threadId,
      )
        .then((result) =>
          source.postMessage(
            { type: "app-response", requestId: request.requestId, result },
            { targetOrigin: event.origin },
          ),
        )
        .catch((reason: unknown) =>
          source.postMessage(
            {
              type: "app-response",
              requestId: request.requestId,
              error: reason instanceof Error ? reason.message : String(reason),
            },
            { targetOrigin: event.origin },
          ),
        );
    };
    tuffite.addEventListener("message", handle);
    return () => tuffite.removeEventListener("message", handle);
  }, [layout, runtime, selectThread, shell, threadId, workbench, overlays, dependencies.workflow]);

  useEffect(() => {
    const host = slot.current;
    if (!host) return;
    setStatus("loading");
    setError(undefined);
    const element = document.createElement("explorer") as ExplorerElement;
    element.className =
      "block h-full min-h-0 w-full min-w-0 !rounded-none border-0 bg-(--background)";
    element.setAttribute("aria-label", i18n.t("conversation.thread"));
    element.behavior = "navigation: delegate;";
    element.behavior += " dialog: delegate;";
    element.contextMenuEnabled = true;
    const context = contextRef.current;
    const url = new URL(surfaceUrl("/thread"));
    url.searchParams.set("thread", context.threadId ?? "");
    url.searchParams.set("draft", context.draftId);
    url.searchParams.set("theme", currentTheme(theme));
    url.searchParams.set("language", currentLanguage(languageMode));
    element.src = url.href;

    const syncAppearance = () => {
      const context = contextRef.current;
      void element.postMessage?.({
        type: "appearance.sync",
        theme: currentTheme(context.theme),
        language: currentLanguage(context.languageMode),
        sidebarOpen: context.sidebarOpen,
        threadId: context.threadId ?? "",
        draftId: context.draftId,
        threadTabs: threadTabsRef.current,
      });
    };
    const loaded = () => {
      setStatus("ready");
      syncAppearance();
    };
    const failed = () => {
      setStatus("failed");
      setError(i18n.t("workspace.theThreadSurfaceCouldNotBeLoaded"));
    };
    let lastOpenRequest: { url: string; at: number } | undefined;
    const open = (event: Event) => {
      const request = (event as CustomEvent<ExplorerOpenRequest>).detail;
      if (!request?.url) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = explorerOpenDestination(event.type, request);
      if (destination === "ignore") return;
      if (destination === "current") {
        element.load(request.url);
        return;
      }
      const now = performance.now();
      if (lastOpenRequest?.url === request.url && now - lastOpenRequest.at < 1_000) return;
      lastOpenRequest = { url: request.url, at: now };
      if (destination === "popup") {
        void openPopupWindow(request.url).catch((error) => {
          console.error(error);
          openWorkbench(
            workbench,
            "browser",
            request.url,
            true,
            contextRef.current.threadId,
            "thread",
          );
        });
        return;
      }
      window.dispatchEvent(
        new CustomEvent("ovule:browser-use", {
          detail: {
            target: request.url,
            threadId: contextRef.current.threadId,
          },
        }),
      );
    };
    const dialog = (event: Event) => {
      void answerDialog((event as CustomEvent<ExplorerDialog>).detail);
    };
    element.addEventListener("loadstop", loaded);
    element.addEventListener("loaderror", failed);
    element.addEventListener("error", failed);
    const appearanceObserver = new MutationObserver(syncAppearance);
    appearanceObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "lang"],
    });
    for (const type of ["navigation", "open", "popup", "newwindow"]) {
      element.addEventListener(type, open);
    }
    element.addEventListener("dialog", dialog);
    host.replaceChildren(element);
    explorer.current = element;
    return () => {
      element.removeEventListener("loadstop", loaded);
      element.removeEventListener("loaderror", failed);
      element.removeEventListener("error", failed);
      appearanceObserver.disconnect();
      for (const type of ["navigation", "open", "popup", "newwindow"]) {
        element.removeEventListener(type, open);
      }
      element.removeEventListener("dialog", dialog);
      if (explorer.current === element) explorer.current = null;
      element.remove();
    };
  }, [generation, workbench, overlays]);

  useEffect(() => {
    const element = explorer.current;
    if (!element || typeof element.postMessage !== "function") return;
    void element.postMessage({
      type: "appearance.sync",
      threadId: threadId ?? "",
      draftId,
      theme: currentTheme(theme),
      language: currentLanguage(languageMode),
      sidebarOpen,
      threadTabs,
    });
  }, [languageMode, sidebarOpen, theme, threadTabs, threadId, draftId]);

  return (
    <section
      className={cn(
        "relative col-start-2 row-start-1 min-h-0 min-w-0 overflow-hidden rounded-none bg-(--background)",
        className,
      )}
      data-thread-surface={status}
    >
      <div
        ref={slot}
        className="block h-full min-h-0 w-full min-w-0 rounded-none border-0 bg-(--background)"
      />
      {status !== "ready" && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 bg-(--background) text-(length:--font-size-ui) text-(--muted-foreground)"
          role={status === "failed" ? "alert" : "status"}
        >
          {status === "loading" ? (
            <>
              <LoaderCircle className="animate-spin" size={18} />{" "}
              {i18n.t("workspace.loadingConversation")}{" "}
            </>
          ) : (
            <>
              <span>{error}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setGeneration((value) => value + 1)}
              >
                <RotateCw size={14} /> {i18n.t("workspace.reload")}{" "}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export const ThreadSurfaceFactory = create((dependsOn) => {
  const runtime = dependsOn(shellTokens.snapshotSync);
  const shell = dependsOn(shellTokens.shell);
  const workbench = dependsOn(panesTokens.panes);
  const overlays = dependsOn(frameworkTokens.mainOverlay);
  const layout = dependsOn(frameworkTokens.frameworkLayout);
  const workflow = dependsOn(workflowTokens.workflowState);
  const dependencies = {
    runtime,
    shell,
    workbench,
    overlays,
    layout,
    workflow,
  };
  return function ThreadSurface(props: {
    threadId?: string;
    theme: ThemeMode;
    languageMode: LanguageMode;
    selectThread(id: string): void;
    className?: string;
  }) {
    return createElement(ThreadSurfaceContent, { dependencies, props });
  };
}, "ThreadSurface");

export const ThreadSurface = (...args: Parameters<ServiceOf<typeof ThreadSurfaceFactory>>) =>
  createElement(useService(ThreadSurfaceFactory), ...args);

export async function handleRootRequest(
  channel: string,
  payload: unknown,
  services: {
    overlays: MainOverlayService;
    workflow: WorkflowStateService;
    runtime: SnapshotSyncService;
    shell: ShellService;
    workbench: PanesService;
    layout: FrameworkLayoutService;
  },
  selectThread: (id: string) => void,
  threadId?: string,
): Promise<unknown> {
  const value = isRecord(payload) ? payload : {};
  if (channel === "layout.toggleSidebar") {
    services.layout.toggleSidebar();
    return { toggled: true };
  }
  if (channel === "remoteWorkspaces.open") {
    window.dispatchEvent(new CustomEvent("ovule:remote-workspaces-open"));
    return { opened: true };
  }
  if (channel === "workbench.open") {
    // A Thread mutation and its follow-up workbench request can cross separate
    // WebContents before the top-level page receives the asynchronous workspace event.
    // Refresh first so Workflow and other top-level views observe the state
    // that caused this request.
    await services.runtime.load();
    const kind = isWorkbenchKind(value.kind) ? value.kind : "browser";
    const target = typeof value.target === "string" ? value.target : undefined;
    if (kind === "browser" && target && /^ovule:/i.test(target)) {
      const state = services.workbench.current();
      return {
        tabId:
          (threadId ? state.activeThreadArtifacts[threadId] : state.activeWorkbenchPaneId) ?? "",
      };
    }
    const source =
      typeof value.fromTab === "string"
        ? services.workbench.current().instances.find((tab) => tab.id === value.fromTab)
        : undefined;
    // Requests originating in a Thread stay attached to that conversation.
    // Moving a tab to the right Workbench is an explicit user action.
    const placement =
      value.placement === "workbench" ? "workbench" : (source?.placement ?? "thread");
    return {
      tabId: openWorkbench(
        services.workbench,
        kind,
        target,
        value.newInstance === true,
        source?.threadId ?? threadId,
        placement,
      ),
    };
  }
  if (channel === "newTab.open") {
    const tabId = typeof value.tabId === "string" ? value.tabId : "";
    const source = services.workbench.current().instances.find((tab) => tab.id === tabId);
    if (!source || source.kind !== "browser" || source.target || source.url)
      throw new Error("invalidNewTab");
    const kind = value.kind;
    if (!["files", "terminal", "workflow", "spice"].includes(String(kind)))
      throw new Error("invalidNewTabAction");
    return new Promise((resolve, reject) =>
      window.dispatchEvent(
        new CustomEvent("ovule:new-tab-action", { detail: { tabId, kind, resolve, reject } }),
      ),
    );
  }

  if (channel === "links.open") {
    const target = typeof value.target === "string" ? value.target : "";
    if (!/^(?:https?|file):\/\//i.test(target)) throw new Error("invalidExplorerURL");
    const source =
      typeof value.fromTab === "string"
        ? services.workbench.current().instances.find((tab) => tab.id === value.fromTab)
        : undefined;
    window.dispatchEvent(
      new CustomEvent("ovule:browser-use", {
        detail: {
          target,
          threadId: source?.threadId ?? threadId,
          navigation: value.navigation === "allow" ? "allow" : "emit",
        },
      }),
    );
    return { opened: true };
  }
  if (channel === "explorer.openOverlay") {
    const target = typeof value.target === "string" ? value.target : "";
    if (!/^(?:https?|file):\/\//i.test(target)) throw new Error("invalidExplorerURL");
    const source =
      typeof value.fromTab === "string"
        ? services.workbench.current().instances.find((tab) => tab.id === value.fromTab)
        : undefined;
    services.overlays.openExplorer({
      target,
      threadId: source?.threadId ?? threadId,
    });
    return { opened: true };
  }
  if (channel === "window.openPopup") {
    const target = typeof value.target === "string" ? value.target : "";
    if (!/^https?:\/\//i.test(target)) throw new Error("invalidPopupURL");
    const popup = await services.shell.openPopupWindow(target);
    return { windowId: popup.id };
  }
  if (channel === "tab.ready") {
    window.dispatchEvent(new CustomEvent("ovule:tab-ready", { detail: value.tabId }));
    return { ready: true };
  }
  if (channel === "tab.metadata") {
    const tabId = typeof value.tabId === "string" ? value.tabId : "";
    const values: {
      title?: string;
      url?: string;
      target?: string;
      canGoBack?: boolean;
      canGoForward?: boolean;
      toolbarState?: Record<string, string>;
    } = {};
    if (typeof value.title === "string" && value.title) values.title = value.title;
    if (typeof value.url === "string") values.url = value.url;
    if (typeof value.target === "string") values.target = value.target;
    if (typeof value.canGoBack === "boolean") values.canGoBack = value.canGoBack;
    if (typeof value.canGoForward === "boolean") values.canGoForward = value.canGoForward;
    if (
      value.toolbarState &&
      typeof value.toolbarState === "object" &&
      !Array.isArray(value.toolbarState)
    ) {
      values.toolbarState = Object.fromEntries(
        Object.entries(value.toolbarState).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
    services.workbench.updateTab(tabId, values);
    return { updated: true };
  }
  if (channel === "dialog.saveFile") {
    const options = value.options as Record<string, unknown> | undefined;
    if (
      !Array.isArray(value.contents) ||
      value.contents.length > 64 * 1024 * 1024 ||
      !value.contents.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    )
      throw new Error("invalidFileContents");
    const path = await (
      await services.shell.dialog()
    ).saveFile(
      {
        title: typeof options?.title === "string" ? options.title : undefined,
        defaultPath: typeof options?.defaultPath === "string" ? options.defaultPath : undefined,
      },
      value.contents,
    );
    return { path };
  }
  if (channel === "dialog.openFile") {
    const path = await (
      await services.shell.dialog()
    ).openFile({
      title: typeof value.title === "string" ? value.title : undefined,
      defaultPath: typeof value.defaultPath === "string" ? value.defaultPath : undefined,
      extensions: Array.isArray(value.extensions)
        ? value.extensions.filter(
            (item): item is string[] =>
              Array.isArray(item) && item.every((x) => typeof x === "string"),
          )
        : undefined,
    });
    return { path };
  }
  if (channel === "workspace.refresh") {
    await services.runtime.load();
    return { refreshed: true };
  }
  if (channel === "thread.bindDraft") {
    if (
      typeof value.draftId !== "string" ||
      typeof value.threadId !== "string" ||
      !value.threadId ||
      value.draftId !== services.workbench.current().draftConversationId
    )
      throw new Error("invalidDraftBinding");
    services.workbench.bindDraftToThread(value.draftId, value.threadId);
    return { bound: true };
  }
  if (channel === "thread.select") {
    if (typeof value.threadId !== "string" || !value.threadId) throw new Error("invalidThreadId");
    services.workbench.selectThreadArtifact(value.threadId);
    selectThread(value.threadId);
    return { selected: true };
  }
  if (channel === "tab.select") {
    if (typeof value.tabId !== "string" || !value.tabId) throw new Error("invalidTabId");
    const tab = services.workbench.current().instances.find((item) => item.id === value.tabId);
    const belongsToConversation = threadId
      ? Boolean(
          tab?.threadId &&
            threadFamilyOwners(threadId, services.workflow.current().snapshot).has(tab.threadId),
        )
      : tab?.draftId === services.workbench.current().draftConversationId;
    if (!tab || tab.placement !== "thread" || !belongsToConversation) {
      throw new Error("tabDoesNotBelongToThisThread");
    }
    if (tab.threadId && tab.threadId !== threadId) selectThread(tab.threadId);
    services.workbench.selectTab(value.tabId);
    return { selected: true };
  }
  if (channel === "dialog.openDirectory") {
    const selected = await (
      await services.shell.dialog()
    ).openDirectory({
      title: typeof value.title === "string" ? value.title : undefined,
    });
    return { path: selected ?? null };
  }
  if (channel === "ui.notification.show") {
    window.dispatchEvent(new CustomEvent("ovule:notification", { detail: value }));
    return { shown: true };
  }
  if (channel === "ui.dialog.open") {
    if (value.kind !== "message-telemetry") {
      throw new Error("unsupportedGlobalDialog");
    }
    if (typeof value.messageId !== "string" || !value.messageId) {
      throw new Error("invalidGlobalDialogRequest");
    }
    await services.runtime.load();
    window.dispatchEvent(
      new CustomEvent("ovule:global-dialog", {
        detail: {
          kind: value.kind,
          messageId: value.messageId,
          runtime: isRecord(value.runtime) ? value.runtime : undefined,
        },
      }),
    );
    return { shown: true };
  }
  throw new Error(`Unsupported App request: ${channel}`);
}

function openWorkbench(
  workbench: PanesService,
  kind: PaneKind,
  target?: string,
  newInstance = false,
  threadId?: string,
  placement: "thread" | "workbench" = "workbench",
): string {
  const state = workbench.current();
  if (placement === "thread" && target) {
    const existing = state.instances.find(
      (tab) =>
        tab.placement === "thread" &&
        (tab.threadId ?? tab.draftId) === (threadId ?? state.draftConversationId) &&
        tab.kind === kind &&
        tab.target === target,
    );
    if (existing) {
      workbench.selectTab(existing.id);
      return existing.id;
    }
  }
  return workbench.openTab(kind, {
    placement,
    newInstance:
      newInstance ||
      kind === "browser" ||
      kind === "office" ||
      kind === "terminal" ||
      kind === "handoff",
    target,
    autoLoad: Boolean(target),
    draftId: placement === "thread" && !threadId ? state.draftConversationId : undefined,
    threadId,
  });
}

async function answerDialog(dialog?: ExplorerDialog) {
  if (!dialog) return;
  let accept = true;
  let promptText = dialog.defaultValue ?? "";
  if (dialog.type === "alert") window.alert(dialog.message);
  else if (dialog.type === "prompt") {
    const answer = window.prompt(dialog.message, dialog.defaultValue);
    accept = answer !== null;
    promptText = answer ?? "";
  } else {
    accept = window.confirm(
      dialog.type === "beforeunload"
        ? "This conversation page has unsaved changes. Leave it?"
        : dialog.message,
    );
  }
  await (accept ? dialog.accept(promptText) : dialog.dismiss());
}

function resolveTheme(theme: ThemeMode): "light" | "dark" {
  return theme === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : theme;
}

function currentTheme(fallback: ThemeMode): "light" | "dark" {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : resolveTheme(fallback);
}

function resolveLanguage(language: LanguageMode): "zh-CN" | "en" {
  return language === "system"
    ? navigator.language.toLocaleLowerCase().startsWith("zh")
      ? "zh-CN"
      : "en"
    : language;
}

function currentLanguage(fallback: LanguageMode): "zh-CN" | "en" {
  return document.documentElement.lang === "zh-CN" || document.documentElement.lang === "en"
    ? document.documentElement.lang
    : resolveLanguage(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
