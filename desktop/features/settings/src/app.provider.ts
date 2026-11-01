import settingsTokens from "./settings.token";
import type { Register } from "@ovule/ioc";
import { ExtensionCatalogHookFactory } from "./extensions/useExtensionCatalog";
import { lazy } from "react";
import { value } from "@ovule/ioc";
import { createPreferencesService, linkOpening } from "./preferences/service";
import { ThemeModeHookFactory } from "./preferences/useThemeMode";
import type { ThemeMode } from "./preferences/preferences";
import { createAgentsStateService } from "./agents/state-service";
import { createModelsStateService } from "./models/state-service";
import { createSettingsStateService } from "./settings/state-service";
import { createSkillsStateService } from "./skills/state-service";
import { createToolsStateService } from "./tools/state-service";
export default function register(register: Register): void {
  registerExtensions(register);
  registerPreferences(register);
  registerAgentsState(register);
  registerModelsState(register);
  registerOnboardingRoute(register);
  registerSettingsState(register);
  registerSkillsState(register);
  registerToolsState(register);
}

function registerAgentsState(register: Register): void {
  register(settingsTokens.agentsStateController, () => createAgentsStateService());
  register(
    settingsTokens.agentsState,
    (dependsOn) => dependsOn(settingsTokens.agentsStateController).service,
  );
}

function registerModelsState(register: Register): void {
  register(settingsTokens.modelsStateController, () => createModelsStateService());
  register(
    settingsTokens.modelsState,
    (dependsOn) => dependsOn(settingsTokens.modelsStateController).service,
  );
}

function registerOnboardingRoute(register: Register): void {
  const OnboardingPage = lazy(() =>
    import("./onboarding/OnboardingPage.tsx").then((module) => ({
      default: module.OnboardingPage,
    })),
  );
  register(settingsTokens.routeRuntime, value({ OnboardingPage }));
}

function registerSettingsState(register: Register): void {
  register(settingsTokens.settingsStateController, () => createSettingsStateService());
  register(
    settingsTokens.settingsState,
    (dependsOn) => dependsOn(settingsTokens.settingsStateController).service,
  );
}

function registerSkillsState(register: Register): void {
  register(settingsTokens.skillsStateController, () => createSkillsStateService());
  register(
    settingsTokens.skillsState,
    (dependsOn) => dependsOn(settingsTokens.skillsStateController).service,
  );
}

function registerToolsState(register: Register): void {
  register(settingsTokens.toolsStateController, () => createToolsStateService());
  register(
    settingsTokens.toolsState,
    (dependsOn) => dependsOn(settingsTokens.toolsStateController).service,
  );
}

function registerExtensions(register: Register): void {
  register(settingsTokens.extensionCatalogHook, (dependsOn) =>
    dependsOn(ExtensionCatalogHookFactory),
  );
}

function registerPreferences(register: Register): void {
  register(settingsTokens.preferences, (dependsOn) => {
    const mode = (value: string | null): ThemeMode =>
      value === "light" || value === "dark" ? value : "system";
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    const media =
      typeof matchMedia === "undefined" ? undefined : matchMedia("(prefers-color-scheme: dark)");
    const service = createPreferencesService({
      initialSearchUrl: storage?.getItem("ovule.search.url"),
      persistSearchUrl: (url) => storage?.setItem("ovule.search.url", url),
      observeSearchUrl: (listener) => {
        if (typeof window === "undefined") return () => {};
        const change = (event: StorageEvent) => {
          if (event.key === "ovule.search.url" || event.key === null)
            listener(storage?.getItem("ovule.search.url") ?? null);
        };
        window.addEventListener("storage", change);
        return () => window.removeEventListener("storage", change);
      },
      initialLinkOpening: linkOpening(storage?.getItem("ovule.linkOpening") ?? null),
      persistLinkOpening: (value) => storage?.setItem("ovule.linkOpening", value),
      observeLinkOpening: (listener) => {
        if (typeof window === "undefined") return () => {};
        const change = (event: StorageEvent) => {
          if (event.key === "ovule.linkOpening" || event.key === null)
            listener(linkOpening(storage?.getItem("ovule.linkOpening") ?? null));
        };
        window.addEventListener("storage", change);
        return () => window.removeEventListener("storage", change);
      },
      initialTheme: mode(storage?.getItem("ovule.theme") ?? null),
      systemDark: () => media?.matches ?? false,
      persist: (value) => storage?.setItem("ovule.theme", value),
      apply: (theme, themeMode) => {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.theme = theme;
          document.documentElement.dataset.themeMode = themeMode;
          document.documentElement.style.colorScheme = theme;
        }
      },
      observeSystem: (listener) => {
        media?.addEventListener("change", listener);
        return () => media?.removeEventListener("change", listener);
      },
      observeTheme: (listener) => {
        if (typeof window === "undefined") return () => {};
        const change = (event: StorageEvent) => {
          if (event.key === "ovule.theme" || event.key === null)
            listener(mode(storage?.getItem("ovule.theme") ?? null));
        };
        window.addEventListener("storage", change);
        return () => window.removeEventListener("storage", change);
      },
    });
    dependsOn.onDispose(service.dispose);
    return service;
  });
  register(settingsTokens.themeModeHook, (dependsOn) => dependsOn(ThemeModeHookFactory));
}
