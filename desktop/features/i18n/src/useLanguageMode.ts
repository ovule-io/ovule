import i18nTokens from "./i18n.token";
import { create } from "@ovule/ioc";
import { useService, useObservableState } from "@ovule/ioc/react";
export const LanguageModeHookFactory = create((dependsOn) => {
  const service = dependsOn(i18nTokens.i18n);
  return function useLanguageMode() {
    const { languageMode } = useObservableState(service, (state) => state);
    return { languageMode, setLanguageMode: service.setLanguageMode };
  };
}, "useLanguageMode");
export const useLanguageMode = () => useService(LanguageModeHookFactory)();
