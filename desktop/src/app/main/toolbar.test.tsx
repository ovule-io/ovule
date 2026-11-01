import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { ReaderContext } from "@ovule/ioc/bridge";
import { createRegistry, createScope } from "@ovule/ioc-container";
import panesTokens from "@ovule/panes/panes.token";
import type { PaneInstance } from "@ovule/panes/tab";
import { registerDesktopServices } from "../services";
import { registerMainServices } from "./services";

const i18n = createInstance();
await i18n.init({ lng: "en", resources: {} });

for (const variant of ["workspace", "workbench"] as const) {
  for (const kind of [
    "browser",
    "terminal",
    "office",
    "markdown",
    "files",
    "spice",
    "workflow",
    "handoff",
  ] as const) {
    test(`${variant} toolbar renders ${kind} through the main service scope`, async () => {
      const app = createScope(registerDesktopServices(createRegistry()));
      const main = createScope(registerMainServices(createRegistry()), app);
      try {
        const Toolbar = main.get(
          variant === "workspace"
            ? panesTokens.workspaceToolbarView
            : panesTokens.workbenchToolbarView,
        );
        const active: PaneInstance = {
          id: "pane",
          kind,
          title: "Active pane",
          target: "https://example.com/page",
          requestVersion: 0,
        };
        const html = renderToStaticMarkup(
          <ReaderContext.Provider
            value={{
              read: (key) => main.get(key),
              readAsync: (key) => main.get(key),
              readOptional: (key) => main.getOptional(key),
            }}
          >
            <I18nextProvider i18n={i18n}>
              {createElement(Toolbar, { tabs: [active], active })}
            </I18nextProvider>
          </ReaderContext.Provider>,
        );
        expect(html).toContain(`data-toolbar-variant="${variant}"`);
        expect(html).toContain("explorerTitlebar.addTab");
        if (variant === "workspace") {
          expect(html).not.toContain("browser.closeTab");
          expect(html).toContain("titlebar.hideSidebar");
          expect(html).toContain("explorerTitlebar.openInWorkbench");
          expect(html).not.toContain('data-titlebar-slot="tab-indicators"');
        } else {
          expect(html).toContain("browser.closeTab");
          expect(html).toContain("explorerTitlebar.expandPanel");
          expect(html).toContain("Active pane");
          expect(html).not.toContain("explorerTitlebar.openInWorkbench");
        }
        if (variant === "workspace" && kind === "browser") {
          expect(html).toContain(">example.com<");
          expect(html).toContain("data-browser-workspace-toolbar");
        }
        if (kind === "terminal") expect(html).toContain("terminal.find");
        if (["office", "files", "markdown"].includes(kind))
          expect(html).toContain(`${kind === "markdown" ? "markdown" : "office"}.save`);
      } finally {
        await main.dispose();
        await app.dispose();
      }
    });
  }
}
