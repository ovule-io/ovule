import { useTranslation } from "react-i18next";
import { CatalogSection } from "@ovule/ui/SettingsSection";
import type { SettingsSectionProps } from "@ovule/settings/settings/settings";
import { HostsPanel } from "./HostsPanel";
export function HostsSection(props: SettingsSectionProps) {
  const { t } = useTranslation();
  return (
    <CatalogSection title={t("hosts.title")} note={t("hosts.description")}>
      <HostsPanel {...props} />
    </CatalogSection>
  );
}
