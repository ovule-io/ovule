import i18nTokens from "./i18n.token";
import type { Register } from "@ovule/ioc";
import { createI18nService } from "./service";
import { LanguageModeHookFactory } from "./useLanguageMode";
import type { LanguageMode } from "./i18n";
import { value } from "@ovule/ioc";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
const localeResources = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
};

export default function register(register: Register): void {
  register(i18nTokens.languageModeHook, (dependsOn) => dependsOn(LanguageModeHookFactory));
  register(i18nTokens.i18n, (dependsOn) => {
    const mode = (value: string | null): LanguageMode =>
      value === "en" || value === "zh-CN" ? value : "system";
    const storage = typeof localStorage === "undefined" ? undefined : localStorage;
    const service = createI18nService({
      resources: localeResources,
      initialMode: mode(storage?.getItem("ovule.language") ?? null),
      systemLanguage: () => (typeof navigator === "undefined" ? "en" : navigator.language),
      persist: (value) => storage?.setItem("ovule.language", value),
      apply: (value) => {
        if (typeof document !== "undefined") document.documentElement.lang = value;
      },
      observeSystem: (listener) => {
        if (typeof window === "undefined") return () => {};
        window.addEventListener("languagechange", listener);
        return () => window.removeEventListener("languagechange", listener);
      },
      observeMode: (listener) => {
        if (typeof window === "undefined") return () => {};
        const change = (event: StorageEvent) => {
          if (event.key === "ovule.language" || event.key === null)
            listener(mode(storage?.getItem("ovule.language") ?? null));
        };
        window.addEventListener("storage", change);
        return () => window.removeEventListener("storage", change);
      },
    });
    dependsOn.onDispose(service.dispose);
    return service;
  });
}
