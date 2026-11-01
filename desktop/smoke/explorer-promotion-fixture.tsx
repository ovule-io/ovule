import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import browserTokens from "@ovule/browser/browser.token";
import i18nTokens from "@ovule/i18n/i18n.token";
import { Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createRegistry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@ovule/ui/drawer";
import "@ovule/ui/styles.css";
import { useService, useServiceState } from "@ovule/ioc/react";
import { I18nextProvider } from "react-i18next";
import registerPanes from "@ovule/panes/main.provider";
import registerFramework from "@ovule/framework/main.provider";
import registerWorkbench from "@ovule/workbench/workbench.provider";
import registerBrowser from "@ovule/browser/app.provider";
import registerTerminal from "@ovule/terminal/app.provider";
import registerShell from "@ovule/shell/app.provider";
import registerI18n from "@ovule/i18n/i18n.provider";

// Model page ownership separately from element lifetime.
const lifecycle = {
  created: 0,
  connected: 0,
  disconnected: 0,
  loads: 0,
  reloads: 0,
  detaches: 0,
  attaches: 0,
};
const transfers = new Map<string, { value: string; history: string[] }>();
const transferControl = { failNextAttach: false };
const paint = { blocked: false, waiting: false, release: undefined as (() => void) | undefined };
const preview =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=";
class TestExplorer extends HTMLElement {
  src = "";
  behavior = "";
  deferred = false;
  page?: { value: string; history: string[] };
  get liveValue() {
    return this.page?.value;
  }
  get history() {
    return this.page?.history ?? [];
  }
  connectedCallback() {
    lifecycle.connected++;
    this.deferred = this.hasAttribute("data-explorer-transfer-target");
    this.textContent = "Live browser surface";
    if (!this.deferred) {
      this.page = {
        value: "unsaved form input",
        history: ["https://example.com/start", "https://example.com/current"],
      };
      queueMicrotask(() =>
        this.dispatchEvent(
          new CustomEvent("loadcommit", {
            detail: {
              url: this.history.at(-1),
              title: "Live page",
              canGoBack: true,
              canGoForward: false,
            },
          }),
        ),
      );
    }
  }
  disconnectedCallback() {
    lifecycle.disconnected++;
    this.page = undefined;
  }
  async detach() {
    if (!this.page) throw new Error("No page");
    lifecycle.detaches++;
    const token = crypto.randomUUID();
    transfers.set(token, this.page);
    this.page = undefined;
    this.dispatchEvent(new Event("detached"));
    return Object.defineProperties(new EventTarget(), {
      token: { value: token },
      state: { get: () => (transfers.has(token) ? "pending" : "transferred") },
      close: {
        value: async () => {
          transfers.delete(token);
        },
      },
    });
  }
  async attach(handle: { token: string }) {
    const token = handle.token;
    if (this.deferred && transferControl.failNextAttach) {
      transferControl.failNextAttach = false;
      throw new Error("Simulated destination attach failure");
    }
    const page = transfers.get(token);
    if (!page || this.page) throw new Error("Invalid transfer");
    lifecycle.attaches++;
    this.page = page;
    transfers.delete(token);
    this.dispatchEvent(new Event("attached"));
  }
  async capturePreview() {
    if (this.deferred && paint.blocked) {
      paint.waiting = true;
      await new Promise<void>((resolve) => {
        paint.release = () => {
          paint.blocked = false;
          paint.waiting = false;
          resolve();
        };
      });
    }
    return preview;
  }
  getNavigationState() {
    return Promise.resolve({
      url: this.history.at(-1),
      title: "Live page",
      canGoBack: true,
      canGoForward: false,
    });
  }
  load(target: string) {
    lifecycle.loads++;
    this.history.push(target);
  }
  reload() {
    lifecycle.reloads++;
    return Promise.resolve(true);
  }
  back() {
    this.history.pop();
    return Promise.resolve(true);
  }
  forward() {
    return Promise.resolve(true);
  }
}
const nativeFixture =
  typeof (window as unknown as { tuffite?: { invoke?: unknown } }).tuffite?.invoke === "function";
if (!nativeFixture) customElements.define("test-explorer", TestExplorer);
const createElement = document.createElement.bind(document);
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  if (tag === "explorer" && !nativeFixture) {
    lifecycle.created++;
    return createElement("test-explorer");
  }
  return createElement(tag, options);
}) as typeof document.createElement;
let nextId = 0;
const container = createRegistry();
const register = container.register.bind(container);
registerTerminal(register);
registerPanes(register, { overrides: { createId: () => String(++nextId), storage: undefined } });
registerFramework(register);
registerWorkbench(register);
registerBrowser(register);
registerShell(register);
registerI18n(register);
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText(value: string) {
      Object.assign(window, { copiedUrl: value });
      return Promise.resolve();
    },
  },
});
function Fixture() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const overlays = useService(frameworkTokens.mainOverlay);
  const explorer = useService(panesTokens.panes);
  const layout = useService(frameworkTokens.frameworkLayout);
  const PaneSurface = useService(panesTokens.paneSurfaceView);
  const { ExplorerOverlay } = useService(browserTokens.routeRuntime);
  const language = useService(i18nTokens.i18n);
  Object.assign(window, {
    promotionTest: { lifecycle, paint, transferControl, overlays, explorer, layout, setDrawerOpen },
  });
  useEffect(() => {
    overlays.openExplorer({
      target:
        (window as unknown as { nativePromotionTarget?: string }).nativePromotionTarget ||
        "https://example.com/start",
      threadId: "thread-test",
    });
  }, [overlays]);
  const state = useServiceState(frameworkTokens.mainOverlay, (value) => value);
  const tabs = useServiceState(panesTokens.panes, (value) => value.instances);
  useEffect(() => {
    for (const tabId of Object.keys(state.explorerTabs))
      if (!tabs.some((tab) => tab.id === tabId)) overlays.releaseExplorerTab(tabId);
  }, [tabs, state.explorerTabs]);
  const entries = state.explorer ? [{ request: state.explorer }] : [];
  return (
    <I18nextProvider i18n={language.instance}>
      {tabs.map((tab) => (
        <PaneSurface
          key={tab.id}
          tab={tab}
          active
          style={{ position: "absolute", left: 20, top: 80, width: 640, height: 400 }}
        />
      ))}
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        direction="left"
        container={document.getElementById("root")}
        noBodyStyles
        disablePreventScroll
      >
        <DrawerContent>
          <DrawerTitle>Sidebar drawer</DrawerTitle>
          <DrawerDescription>Layering regression fixture</DrawerDescription>
          <button onClick={() => setDrawerOpen(false)}>Close sidebar</button>
        </DrawerContent>
      </Drawer>
      {entries.map(({ request }) => (
        <ExplorerOverlay
          key={request.id}
          request={request}
          fallbackThreadId="thread-test"
          sidebarAvailable
        />
      ))}
    </I18nextProvider>
  );
}
createRoot(document.getElementById("root")!).render(
  <ScopeProvider registry={container}>
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  </ScopeProvider>,
);
