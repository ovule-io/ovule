import branding from "../../../../branding.json";
import { createInstance } from "i18next";
import type { I18nEnvironment, I18nService, LanguageMode } from "./i18n";
export function createI18nService(environment: I18nEnvironment): I18nService {
  const instance = createInstance();
  let state = { languageMode: environment.initialMode };
  const listeners = new Set<() => void>();
  const language = () =>
    state.languageMode === "system"
      ? environment.systemLanguage().toLowerCase().startsWith("zh")
        ? "zh-CN"
        : "en"
      : state.languageMode;
  void instance.init({
    resources: environment.resources,
    lng: language(),
    fallbackLng: "en",
    initAsync: false,
    interpolation: { escapeValue: false, defaultVariables: { brandName: branding.displayName } },
  });
  const apply = () => {
    const value = language();
    environment.apply(value);
    void instance.changeLanguage(value);
  };
  const update = (mode: LanguageMode) => {
    if (state.languageMode === mode) return;
    state = { languageMode: mode };
    apply();
    for (const listener of listeners) listener();
  };
  const removeSystem = environment.observeSystem(() => {
    if (state.languageMode === "system") apply();
  });
  const removeMode = environment.observeMode(update);
  apply();
  return {
    instance,
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLanguageMode(mode) {
      environment.persist(mode);
      update(mode);
    },
    dispose() {
      removeSystem();
      removeMode();
      listeners.clear();
      instance.off("languageChanged");
    },
  };
}
