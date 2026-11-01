import panesTokens from "@ovule/panes/panes.token";
import browserTokens from "@ovule/browser/browser.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { lazy } from "react";
import { value } from "@ovule/ioc";
import type { Registry } from "@ovule/ioc-container";
import { registerPaneDefinitions } from "../shared/pane-services";
import { registerSettingsServices } from "./settings-services";
import registerOmnibox from "@ovule/omnibox/omnibox.provider";
import registerFramework from "@ovule/framework/main.provider";
import registerWorkbench from "@ovule/workbench/workbench.provider";

import registerSidebar from "@ovule/sidebar/main.provider";
import registerConnectedApps from "@ovule/connected-apps/connected-apps.provider";
import registerConversation from "@ovule/conversation/main.provider";

import registerBrowser from "@ovule/browser/main.provider";
import registerPanes from "@ovule/panes/main.provider";
import type { PanesOptions } from "@ovule/panes/panes-options";
const ContentView = lazy(() => import("./ContentView").then((m) => ({ default: m.ContentView })));
export type MainServiceOverrides = PanesOptions;
export function registerMainServices(
  registry: Registry,
  overrides: MainServiceOverrides = {},
): Registry {
  const register = registry.register.bind(registry);
  registerSettingsServices(registry);
  registerPanes(register, { overrides });
  registerPaneDefinitions(registry);
  registerOmnibox(register);
  registerFramework(register, overrides);
  registerWorkbench(register);
  registerBrowser(register);
  register(panesTokens.newTabView, (dependsOn) => dependsOn(browserTokens.routeRuntime).NewTabPage);

  registerSidebar(register);
  registerConnectedApps(register);
  registerConversation(register);

  register(frameworkTokens.contentView, value(ContentView));
  return registry;
}
