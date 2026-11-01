import { expect, test } from "bun:test";
import { createPreferencesService } from "./service";
import { defaultSearchUrl, searchUrl, searchEngines } from "./search-engines";
import type { PreferencesEnvironment } from "./preferences";
const environment = (overrides: Partial<PreferencesEnvironment> = {}): PreferencesEnvironment => ({
  initialTheme: "system",
  systemDark: () => false,
  persist() {},
  apply() {},
  observeTheme: () => () => {},
  observeSystem: () => () => {},
  ...overrides,
});
test("engine selection persists, publishes immediately and survives a fresh service", () => {
  let stored: string | undefined;
  const service = createPreferencesService(
    environment({
      persistSearchUrl: (url) => {
        stored = url;
      },
    }),
  );
  expect(service.current().searchEngine).toBe("bing");
  for (const engine of searchEngines) {
    service.setSearchEngine(engine.id);
    expect(service.current().searchUrl).toBe(engine.url);
    expect(stored).toBe(engine.url);
    const restored = createPreferencesService(environment({ initialSearchUrl: stored }));
    expect(restored.current().searchEngine).toBe(engine.id);
    restored.dispose();
  }
  service.dispose();
});
test("storage changes synchronize existing services and clear restores the default", () => {
  let update!: (url: string | null) => void;
  let disposed = false;
  const service = createPreferencesService(
    environment({
      observeSearchUrl: (listener) => {
        update = listener;
        return () => {
          disposed = true;
        };
      },
    }),
  );
  update("https://www.google.com/search?q=");
  expect(service.current().searchEngine).toBe("google");
  update(null);
  expect(service.current().searchUrl).toBe(defaultSearchUrl);
  service.dispose();
  expect(disposed).toBe(true);
});
test("valid existing custom prefixes survive and unsafe stored URLs fall back", () => {
  const custom = "https://search.example/search?query=";
  const service = createPreferencesService(environment({ initialSearchUrl: custom }));
  expect(service.current().searchEngine).toBe("custom");
  expect(service.current().searchUrl).toBe(custom);
  for (const value of [
    "javascript:alert(1)",
    "file:///tmp/",
    "https://name:password@example.com/?q=",
    "garbage",
  ])
    expect(searchUrl(value)).toBe(defaultSearchUrl);
  service.dispose();
});
