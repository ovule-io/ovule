import styles from "./GeneralSettings.module.css";
import { DesktopPermissionsControl } from "./DesktopPermissionsControl";
import { DownloadSettings } from "./DownloadSettings";
import i18nTokens from "@ovule/i18n/i18n.token";
import settingsTokens from "../settings.token";
import { useService, useObservableState } from "@ovule/ioc/react";
import { SearchEngineSettings } from "./SearchEngineSettings";
import type { LinkOpening } from "./preferences";

import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import { ThemeCards } from "./ThemeCards";
import type { LanguageMode } from "@ovule/i18n/i18n";
import { useThemeMode } from "./useThemeMode";
import { CatalogSection } from "@ovule/ui/SettingsSection";
export function PreferencesSection() {
  const preferences = useService(settingsTokens.preferences);
  const linkOpening = useObservableState(preferences, (state) => state.linkOpening);
  const useLanguageMode = useService(i18nTokens.languageModeHook);

  const i18n = useTranslation().i18n;

  const { t } = useTranslation();
  const { theme, setTheme } = useThemeMode();
  const { languageMode, setLanguageMode } = useLanguageMode();
  return (
    <CatalogSection title={t("settings.general")} note={t("settings.description")}>
      <div className={styles.sections} data-general-settings>
        <section
          className={styles.section}
          aria-labelledby="settings-theme-label"
          data-general-section="theme"
        >
          <h4 className={styles.title} id="settings-theme-label">
            {t("settings.theme")}
          </h4>
          <ThemeCards value={theme} onChange={setTheme} />
        </section>
        <section
          className={styles.section}
          aria-labelledby="settings-language-label"
          data-general-section="language"
        >
          <div className={styles.row}>
            <h4 className={styles.title} id="settings-language-label">
              {t("settings.language")}
            </h4>
            <Select
              value={languageMode}
              onValueChange={(value) => setLanguageMode(value as LanguageMode)}
            >
              <SelectTrigger className="language-toggle" aria-labelledby="settings-language-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("settings.system")}</SelectItem>
                <SelectItem value="zh-CN">{i18n.t("preferences.label")}</SelectItem>
                <SelectItem value="en">{i18n.t("preferences.english")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
        <SearchEngineSettings />
        <section
          className={styles.section}
          aria-labelledby="settings-link-opening-label"
          data-general-section="links"
        >
          <div className={styles.row}>
            <h4 className={styles.title} id="settings-link-opening-label">
              {t("settings.linkOpening")}
            </h4>
            <Select
              value={linkOpening}
              onValueChange={(value) => preferences.setLinkOpening(value as LinkOpening)}
            >
              <SelectTrigger aria-labelledby="settings-link-opening-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["overlay", "new-tab", "workbench", "system"] as const).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`settings.linkOpeningModes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>
        <DownloadSettings />
        <DesktopPermissionsControl />
      </div>
    </CatalogSection>
  );
}
