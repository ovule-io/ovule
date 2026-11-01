import type { Registry } from "@ovule/ioc-container";
import registerOmnibox from "@ovule/omnibox/omnibox.provider";
import { registerPaneDefinitions } from "../shared/pane-services";

export function registerPaneServices(registry: Registry): Registry {
  registerOmnibox(registry.register.bind(registry));
  return registerPaneDefinitions(registry);
}
