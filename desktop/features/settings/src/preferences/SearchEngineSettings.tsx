import { useService, useObservableState } from "@ovule/ioc/react";
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ovule/ui/select";
import settingsTokens from "../settings.token";
import type { SearchEngine } from "./preferences";
import { searchEngines } from "./search-engines";
import styles from "./GeneralSettings.module.css";

export function SearchEngineSettings() {
  const preferences = useService(settingsTokens.preferences);
  const value = useObservableState(preferences, (state) => state.searchEngine);
  const { t } = useTranslation();
  return (
    <section
      className={styles.section}
      aria-labelledby="settings-search-engine-label"
      data-general-section="search"
    >
      <div className={styles.row}>
        <h4 className={styles.title} id="settings-search-engine-label">
          {t("settings.searchEngine")}
        </h4>
        <Select
          value={value}
          onValueChange={(value) => preferences.setSearchEngine(value as SearchEngine)}
        >
          <SelectTrigger aria-labelledby="settings-search-engine-label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {searchEngines.map((engine) => (
              <SelectItem key={engine.id} value={engine.id}>
                {engine.name}
              </SelectItem>
            ))}
            {value === "custom" && (
              <SelectItem value="custom" disabled>
                {t("settings.customSearchEngine")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <p className={styles.note}>{t("settings.searchEngineHelp")}</p>
    </section>
  );
}
