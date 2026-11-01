import { PtyPanel } from "../features/terminal/src/PtyPanel";
import { PaneToolbarActions } from "../features/panes/src/toolbar/PaneToolbarActions";
import "@xterm/xterm/css/xterm.css";
import settingsTokens from "@ovule/settings/settings.token";
import { SearchEngineSettings } from "../features/settings/src/preferences/SearchEngineSettings";
import { defaultShellService } from "../features/shell/src/service";
import { createRoot } from "react-dom/client";
import { createRegistry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { useService, useServiceState } from "@ovule/ioc/react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import { TitleBar } from "../features/framework/src/titlebar/TitleBar";
import { PreferencesSection } from "../features/settings/src/preferences/PreferencesSection";
import { useEffect, useState } from "react";
import { registerDesktopServices } from "../src/app/services";
import { registerMainServices } from "../src/app/main/services";
import { handleRootRequest } from "../features/conversation/src/ThreadSurface";
import { PaneSurface } from "../features/panes/src/PaneSurface";
import { BrowserPanel } from "../features/browser/src/BrowserPanel";
import shellTokens from "@ovule/shell/shell.token";
import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import en from "../features/i18n/src/locales/en.json";
import "@ovule/ui/styles.css";
import "../src/app/tailwind.css";

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
const query = new URLSearchParams(location.search);
const boundary = query.has("boundary");
const control = {
  path: undefined as string | undefined,
  dialogs: 0,
  ptyOps: [] as string[],
  ptyState: {} as Record<string, string>,
  permissionChecks: 0,
  permissionDelay: 0,
  accessibilityGranted: false,
  inputGranted: false,
  requestedPermission: "",
  revealedApp: "",
  suggestionDelay: 0,
  preferences: undefined as any,
  lastLoaded: "",
  loads: [] as string[],
  holdMetadata: false,
  pendingMetadata: [] as (() => void)[],
  request: undefined as any,
  panes: undefined as any,
};
Object.assign(window, { experience: control });
const createElement = document.createElement.bind(document);
document.createElement = ((name: string, options?: ElementCreationOptions) => {
  const element = createElement(name, options);
  if (name === "explorer") {
    // Test double for Chromium's NavigationController; product code owns no stack.
    const entries: string[] = [];
    let index = -1;
    const state = () => ({
      url: entries[index] ?? "",
      title: "",
      canGoBack: index > 0,
      canGoForward: index + 1 < entries.length,
    });
    const committed = () =>
      element.dispatchEvent(new CustomEvent("loadcommit", { detail: state() }));
    Object.defineProperty(element, "src", {
      get: () => entries[index] ?? "",
      set: (url: string) => {
        entries.splice(index + 1);
        entries.push(url);
        index = entries.length - 1;
        if (element.isConnected) committed();
      },
    });
    Object.assign(element, {
      getNavigationState: async () => {
        const snapshot = state();
        if (control.holdMetadata)
          return new Promise((resolve) => control.pendingMetadata.push(() => resolve(snapshot)));
        return snapshot;
      },
      load: (url: string) => {
        control.lastLoaded = url;
        control.loads.push(url);
        (element as any).src = url;
      },
      back: async () => {
        if (index > 0) {
          index--;
          committed();
        }
      },
      forward: async () => {
        if (index + 1 < entries.length) {
          index++;
          committed();
        }
      },
    });
  }
  return element;
}) as typeof document.createElement;
const downloadState = {
  items: [],
  directory: "/Users/test/Downloads/a-long-download-folder/complete-path",
};
const shell = {
  macOS: true,
  window: async () => ({ current: async () => ({ maximized: false, fullscreen: false }) }),
  revealLocalFile: async (url: string) => {
    control.revealedApp = url;
    return true;
  },
  downloads: { current: () => downloadState, subscribe: () => () => {}, refresh: async () => {} },
  requestRoot: async (channel: string, payload: any) => {
    if (channel === "tab.metadata" && payload.tabId === "pty-test") {
      control.ptyState = payload.toolbarState;
      window.dispatchEvent(new Event("fixture:pty-metadata"));
      return {};
    }
    return control.request(channel, payload);
  },
  dialog: async () => ({
    openFile: async () => {
      control.dialogs++;
      return control.path;
    },
  }),
  copyText: async () => true,
  resolveBrowserTarget: defaultShellService.resolveBrowserTarget,
  loadExplorer: defaultShellService.loadExplorer,
  htmlPreviewSource: defaultShellService.htmlPreviewSource,
  localExplorerAddress: defaultShellService.localExplorerAddress,
  surfaceUrl: (_route: string, values: Record<string, string>) =>
    `${location.origin}/?guest=1&tab=${values.tab}`,
} as never;
const permissionStatus = () => ({
  appVersion: "0.1.0",
  managed: true,
  bundleId: "test",
  expectedBundleId: "test",
  screenRecording: false,
  screenCaptureVerified: true,
  accessibility: control.accessibilityGranted,
  inputMonitoring: control.inputGranted,
  bundlePath: "/Applications/Ovule.app",
  executablePath: "/Applications/Ovule.app/Contents/MacOS/ovule",
  signingIdentity: "Signature=adhoc",
  otherBundlePaths: ["/Users/test/Desktop/Ovule.app"],
});
const workspace = {
  api: async () => ({
    listSessions: async () => "[]",
    openSession: async (owner: string, profile: string) => {
      control.ptyOps.push(`open:${profile}`);
      return JSON.stringify({
        id: `session-${control.ptyOps.length}`,
        owner,
        profileId: profile,
        directory: "",
      });
    },
    closeSession: async (id: string) => {
      control.ptyOps.push(`close:${id}`);
      return true;
    },
    readSession: async () =>
      JSON.stringify({
        data: [...new TextEncoder().encode("ready\r\n")],
        cursor: 7,
        eof: true,
        truncated: false,
      }),
    resizeSession: async () => true,
    writeSession: async () => true,
    shellProfiles: async () =>
      JSON.stringify([
        { id: "bash", name: "Bash" },
        { id: "zsh", name: "Zsh" },
      ]),
    desktopPermissions: async () => {
      control.permissionChecks++;
      await new Promise((resolve) => setTimeout(resolve, control.permissionDelay));
      return permissionStatus();
    },
    requestDesktopPermission: async (permission: string) => {
      control.requestedPermission = permission;
      if (permission === "inputMonitoring") control.inputGranted = true;
      return permissionStatus();
    },
    browserSuggestions: async (_threadId: string, query: string) => {
      await new Promise((resolve) => setTimeout(resolve, control.suggestionDelay));
      return [
        {
          id: "search-web",
          kind: "search",
          title: `Search for ${query}`,
          detail: "Search the web",
          target: query,
        },
      ];
    },
  }),
} as never;
const registry = registerMainServices(
  registerDesktopServices(createRegistry(), { shell, workspace }),
  {
    storage: query.has("restore") ? localStorage : { getItem: () => null, setItem: () => {} },
  },
);
function Fixture() {
  control.preferences = useService(settingsTokens.preferences);
  const panes = useService(panesTokens.panes);
  const { PaneToolbar } = { PaneToolbar: useService(panesTokens.paneToolbarView) };
  const runtime = useService(shellTokens.snapshotSync);
  const layout = useService(frameworkTokens.frameworkLayout);
  const overlays = useService(frameworkTokens.mainOverlay);
  const workflow = useService(workflowTokens.workflowState);
  const tabs = useServiceState(panesTokens.panes, (state) => state.instances);
  const id = useServiceState(panesTokens.panes, (state) => state.activeWorkbenchPaneId);
  const active = tabs.find((tab) => tab.id === id);
  control.panes = panes;
  control.request = (channel: string, payload: unknown) =>
    handleRootRequest(
      channel,
      payload,
      { runtime, shell, workbench: panes, layout, overlays, workflow },
      () => {},
    );
  useEffect(() => {
    runtime.acceptSnapshot({
      revision: 1n,
      threads: [],
      messages: [],
      goals: [],
      nodes: [],
      attempts: [],
      terminalRuns: [],
      projects: [],
      bindings: [],
      hosts: [],
      agents: [],
      models: [],
      skills: [],
      tools: [],
      capabilities: [],
      legacyDataIssues: [],
      endpoints: [{ id: "remote", displayName: "Test remote", transport: "tunnel" }],
    } as never);
    if (!query.has("restore"))
      panes.openTab("browser", { placement: "workbench", newInstance: true });
  }, []);
  return (
    <main
      className="app-shell"
      style={{ height: 600, display: "grid", gridTemplateRows: "56px 1fr" }}
    >
      <PaneToolbar tabs={tabs} active={active} workbench={!query.has("restore")} />
      {boundary ? (
        tabs.map((tab) => (
          <PaneSurface
            key={tab.id}
            tab={tab}
            active={tab.id === id}
            style={{ position: "fixed", left: 0, top: 56, width: 920, height: 544 }}
          />
        ))
      ) : active?.kind === "browser" && !active.target ? (
        <BrowserPanel key={active.id} tabId={active.id} chrome={false} />
      ) : (
        <div data-opened-kind={active?.kind} />
      )}
    </main>
  );
}
function PtyFixture() {
  const [state, setState] = useState<Record<string, string>>(control.ptyState);
  useEffect(() => {
    const receive = () => setState(control.ptyState);
    window.addEventListener("fixture:pty-metadata", receive);
    return () => window.removeEventListener("fixture:pty-metadata", receive);
  }, []);
  const command = (action: string) =>
    window.dispatchEvent(
      new CustomEvent("ovule:pane-command", { detail: { action, tabId: "pty-test" } }),
    );
  return (
    <div style={{ height: 600, display: "grid", gridTemplateRows: "48px minmax(0,1fr)" }}>
      <header
        data-pty-toolbar
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid #ddd",
          padding: 8,
        }}
      >
        <span>Terminal 1</span>
        <PaneToolbarActions
          tab={{
            id: "pty-test",
            kind: "terminal",
            title: "Terminal 1",
            requestVersion: 0,
            toolbarState: state,
          }}
          command={command}
          startSearch={() => command("search:ready")}
        />
      </header>
      <PtyPanel workspace={workspace} owner="pty-test" initialProfile="zsh" />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <ScopeProvider registry={registry}>
      {query.has("pty") ? (
        <PtyFixture />
      ) : query.has("titlebar") ? (
        <TitleBar
          title="Ovule"
          workbenchOpen={query.has("workbench")}
          settingsOpen={query.has("settings")}
          onboardingOpen={query.has("onboarding")}
          onBackToChat={() => {}}
          onToggleWorkbench={() => {}}
          onOpenSettings={() => {}}
          onOpenOnboarding={() => {}}
        />
      ) : query.has("general") ? (
        <div style={{ padding: 24, height: 650, overflow: "auto" }}>
          <PreferencesSection />
        </div>
      ) : query.has("settings") ? (
        <SearchEngineSettings />
      ) : (
        <Fixture />
      )}
    </ScopeProvider>
  </I18nextProvider>,
);
