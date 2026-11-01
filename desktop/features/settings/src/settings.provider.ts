import settingsTokens from "./settings.token";
import { value, type Register } from "@ovule/ioc";
import { lazy } from "react";

export default function register(register: Register): void {
  register(
    settingsTokens.desktopPermissionsView,
    value(
      lazy(() =>
        import("./preferences/DesktopPermissionsControl").then((m) => ({
          default: m.DesktopPermissionsControl,
        })),
      ),
    ),
  );
  register(
    settingsTokens.agentsSettingsView,
    value(lazy(() => import("./agents/AgentsSection").then((m) => ({ default: m.AgentsSection })))),
  );
  register(
    settingsTokens.modelsSettingsView,
    value(lazy(() => import("./models/ModelsSection").then((m) => ({ default: m.ModelsSection })))),
  );
  register(
    settingsTokens.ollamaSetupView,
    value(
      lazy(() => import("./ollama/OllamaSetupCard").then((m) => ({ default: m.OllamaSetupCard }))),
    ),
  );
  register(
    settingsTokens.skillsSettingsView,
    value(lazy(() => import("./skills/SkillsSection").then((m) => ({ default: m.SkillsSection })))),
  );
  register(
    settingsTokens.toolsSettingsView,
    value(lazy(() => import("./tools/ToolsSection").then((m) => ({ default: m.ToolsSection })))),
  );
  register(
    settingsTokens.toolchainsSettingsView,
    value(
      lazy(() =>
        import("./toolchains/ToolchainsSection").then((m) => ({ default: m.ToolchainsSection })),
      ),
    ),
  );
  register(
    settingsTokens.extensionsSettingsView,
    value(
      lazy(() =>
        import("./extensions/ExtensionsSection").then((m) => ({ default: m.ExtensionsSection })),
      ),
    ),
  );
  register(
    settingsTokens.preferencesSettingsView,
    value(
      lazy(() =>
        import("./preferences/PreferencesSection").then((m) => ({ default: m.PreferencesSection })),
      ),
    ),
  );
  register(settingsTokens.settingsSections, (dependsOn) => ({
    general: dependsOn(settingsTokens.preferencesSettingsView),
    hosts: dependsOn(settingsTokens.hostsSettingsView),
    agents: dependsOn(settingsTokens.agentsSettingsView),
    models: dependsOn(settingsTokens.modelsSettingsView),
    skills: dependsOn(settingsTokens.skillsSettingsView),
    tools: dependsOn(settingsTokens.toolsSettingsView),
    toolchains: dependsOn(settingsTokens.toolchainsSettingsView),
    extensions: dependsOn(settingsTokens.extensionsSettingsView),
  }));
  register(
    settingsTokens.settingsPanelView,
    value(
      lazy(() => import("./settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel }))),
    ),
  );
}
