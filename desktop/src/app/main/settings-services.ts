import type { Registry } from "@ovule/ioc-container";
import registerSettings from "@ovule/settings/settings.provider";
import registerHosts from "@ovule/hosts/settings.provider";

export function registerSettingsServices(registry: Registry): Registry {
  const register = registry.register.bind(registry);
  registerSettings(register);
  registerHosts(register);

  return registry;
}
