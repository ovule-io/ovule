import { createToken, tokens } from "@ovule/ioc";
import type { AgentsStateService, AgentsStateController } from "./agents/state";
import type { ModelsStateService, ModelsStateController } from "./models/state";
import type { RouteRuntime } from "./onboarding/route";
import type {
  SettingsPanelViewTokenValue,
  DesktopPermissionsViewTokenValue,
  SettingsSectionsTokenValue,
  OllamaSetupViewTokenValue,
  PreferencesSettingsViewTokenValue,
  HostsSettingsViewTokenValue,
  AgentsSettingsViewTokenValue,
  ModelsSettingsViewTokenValue,
  SkillsSettingsViewTokenValue,
  ToolsSettingsViewTokenValue,
  ToolchainsSettingsViewTokenValue,
  ExtensionsSettingsViewTokenValue,
} from "./settings/settings";
import type { SettingsStateService, SettingsStateController } from "./settings/state";
import type { SkillsStateService, SkillsStateController } from "./skills/state";
import type { ToolsStateService, ToolsStateController } from "./tools/state";

import type { ExtensionCatalogView, ExtensionCatalogHook } from "./extensions/extensions";
import type { PreferencesService, ThemeModeHook } from "./preferences/preferences";
export default tokens({
  desktopPermissionsView: createToken<DesktopPermissionsViewTokenValue>("DesktopPermissionsView"),
  extensionCatalog: createToken<ExtensionCatalogView>("ExtensionCatalog"),
  extensionCatalogHook: createToken<ExtensionCatalogHook>("ExtensionCatalogHook"),
  preferences: createToken<PreferencesService>("PreferencesService"),
  themeModeHook: createToken<ThemeModeHook>("ThemeModeHook"),
  agentsStateController: createToken<AgentsStateController>("AgentsStateController"),
  agentsState: createToken<AgentsStateService>("AgentsStateService"),
  modelsStateController: createToken<ModelsStateController>("ModelsStateController"),
  modelsState: createToken<ModelsStateService>("ModelsStateService"),
  routeRuntime: createToken<RouteRuntime>("onboardingRouteRuntime"),
  settingsPanelView: createToken<SettingsPanelViewTokenValue>("SettingsPanelView"),
  settingsSections: createToken<SettingsSectionsTokenValue>("SettingsSections"),
  ollamaSetupView: createToken<OllamaSetupViewTokenValue>("OllamaSetupView"),
  preferencesSettingsView:
    createToken<PreferencesSettingsViewTokenValue>("PreferencesSettingsView"),
  hostsSettingsView: createToken<HostsSettingsViewTokenValue>("HostsSettingsView"),
  agentsSettingsView: createToken<AgentsSettingsViewTokenValue>("AgentsSettingsView"),
  modelsSettingsView: createToken<ModelsSettingsViewTokenValue>("ModelsSettingsView"),
  skillsSettingsView: createToken<SkillsSettingsViewTokenValue>("SkillsSettingsView"),
  toolsSettingsView: createToken<ToolsSettingsViewTokenValue>("ToolsSettingsView"),
  toolchainsSettingsView: createToken<ToolchainsSettingsViewTokenValue>("ToolchainsSettingsView"),
  extensionsSettingsView: createToken<ExtensionsSettingsViewTokenValue>("ExtensionsSettingsView"),
  settingsStateController: createToken<SettingsStateController>("SettingsStateController"),
  settingsState: createToken<SettingsStateService>("SettingsStateService"),
  skillsStateController: createToken<SkillsStateController>("SkillsStateController"),
  skillsState: createToken<SkillsStateService>("SkillsStateService"),
  toolsStateController: createToken<ToolsStateController>("ToolsStateController"),
  toolsState: createToken<ToolsStateService>("ToolsStateService"),
});
