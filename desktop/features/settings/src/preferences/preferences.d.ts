export type ThemeMode = "system" | "light" | "dark";
export type LinkOpening = "overlay" | "new-tab" | "workbench" | "system";
export type SearchEngine = "bing" | "google" | "baidu" | "duckduckgo";
export interface PreferencesService {
  current(): {
    theme: ThemeMode;
    linkOpening: LinkOpening;
    searchEngine: SearchEngine | "custom";
    searchUrl: string;
  };
  subscribe(listener: () => void): () => void;
  setTheme(mode: ThemeMode): void;
  setLinkOpening(mode: LinkOpening): void;
  setSearchEngine(engine: SearchEngine): void;
  dispose(): void;
}
export type ThemeModeHook = () => {
  theme: ThemeMode;
  setTheme(mode: ThemeMode): void;
};
export type PreferencesEnvironment = {
  initialSearchUrl?: string | null;
  persistSearchUrl?(url: string): void;
  observeSearchUrl?(listener: (url: string | null) => void): () => void;
  initialLinkOpening?: LinkOpening;
  persistLinkOpening?(mode: LinkOpening): void;
  observeLinkOpening?(listener: (mode: LinkOpening) => void): () => void;
  initialTheme: ThemeMode;
  systemDark(): boolean;
  persist(theme: ThemeMode): void;
  apply(theme: "light" | "dark", mode: ThemeMode): void;
  observeSystem(listener: () => void): () => void;
  observeTheme(listener: (theme: ThemeMode) => void): () => void;
};
