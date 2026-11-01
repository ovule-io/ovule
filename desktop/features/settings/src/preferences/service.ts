import { searchEngine, searchEngines, searchUrl } from "./search-engines";
import { createObservable } from "@ovule/ioc/observable";
import type {
  PreferencesService,
  PreferencesEnvironment,
  ThemeMode,
  LinkOpening,
} from "./preferences";
export function linkOpening(value: string | null): LinkOpening {
  return value === "new-tab" || value === "workbench" || value === "system" ? value : "overlay";
}
export function createPreferencesService(environment: PreferencesEnvironment): PreferencesService {
  const store = createObservable({
    theme: environment.initialTheme,
    searchUrl: searchUrl(environment.initialSearchUrl),
    searchEngine: searchEngine(searchUrl(environment.initialSearchUrl)),
    linkOpening: environment.initialLinkOpening ?? "overlay",
  });
  const updateSearchUrl = (value: string | null) => {
    const url = searchUrl(value);
    if (url === store.service.current().searchUrl) return;
    store.stage({ ...store.service.current(), searchUrl: url, searchEngine: searchEngine(url) });
    store.notify();
  };
  const removeSearchUrl = environment.observeSearchUrl?.(updateSearchUrl);
  const updateLinkOpening = (linkOpening: LinkOpening) => {
    store.stage({ ...store.service.current(), linkOpening });
    store.notify();
  };
  const removeLinkOpening = environment.observeLinkOpening?.(updateLinkOpening);
  const apply = () => {
    const mode = store.service.current().theme;
    environment.apply(
      mode === "system" ? (environment.systemDark() ? "dark" : "light") : mode,
      mode,
    );
  };
  const update = (theme: ThemeMode) => {
    if (theme === store.service.current().theme) return;
    store.stage({ ...store.service.current(), theme });
    apply();
    store.notify();
  };
  const removeSystem = environment.observeSystem(() => {
    if (store.service.current().theme === "system") apply();
  });
  const removeTheme = environment.observeTheme(update);
  apply();
  return {
    ...store.service,
    setSearchEngine(engine) {
      const entry = searchEngines.find((item) => item.id === engine);
      if (!entry) return;
      environment.persistSearchUrl?.(entry.url);
      updateSearchUrl(entry.url);
    },
    setLinkOpening(mode) {
      environment.persistLinkOpening?.(mode);
      updateLinkOpening(mode);
    },
    setTheme(theme) {
      environment.persist(theme);
      update(theme);
    },
    dispose() {
      removeSearchUrl?.();
      removeLinkOpening?.();
      removeSystem();
      removeTheme();
    },
  };
}
