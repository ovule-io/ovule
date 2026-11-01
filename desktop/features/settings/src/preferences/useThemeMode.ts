import settingsTokens from "@ovule/settings/settings.token";
import { create } from "@ovule/ioc";
import { useService, useObservableState } from "@ovule/ioc/react";
export const ThemeModeHookFactory = create((dependsOn) => {
  const service = dependsOn(settingsTokens.preferences);
  return function useThemeMode() {
    const { theme } = useObservableState(service, (state) => state);
    return { theme, setTheme: service.setTheme };
  };
}, "useThemeMode");
export const useThemeMode = () => useService(ThemeModeHookFactory)();
