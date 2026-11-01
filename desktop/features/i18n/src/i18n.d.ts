import type { i18n, Resource } from "i18next";
export type LanguageMode = "system" | "zh-CN" | "en";
export interface I18nService {
  readonly instance: i18n;
  current(): { languageMode: LanguageMode };
  subscribe(listener: () => void): () => void;
  setLanguageMode(mode: LanguageMode): void;
  dispose(): void;
}
export type I18nEnvironment = {
  resources: Resource;
  initialMode: LanguageMode;
  systemLanguage(): string;
  persist(mode: LanguageMode): void;
  apply(language: string): void;
  observeSystem(listener: () => void): () => void;
  observeMode(listener: (mode: LanguageMode) => void): () => void;
};
export type LanguageModeHook = () => {
  languageMode: LanguageMode;
  setLanguageMode(mode: LanguageMode): void;
};
