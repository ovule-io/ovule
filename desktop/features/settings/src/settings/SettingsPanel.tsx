import settingsTokens from "../settings.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import {
  Bot,
  Box,
  BrainCircuit,
  SlidersHorizontal,
  PackagePlus,
  PlugZap,
  Puzzle,
  ServerCog,
  Settings2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@ovule/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@ovule/ui/sidebar";
import { useService } from "@ovule/ioc/react";
import { cn } from "@ovule/ui/cn";
import styles from "./SettingsPanel.module.css";
import { Suspense } from "react";
import type { SettingsPanelProps, SettingsSectionId } from "./settings";
import { useObservableState } from "@ovule/ioc/react";
type SettingsPanelDependencies = {
  views: ServiceOf<typeof settingsTokens.settingsSections>;
  selectionService: ServiceOf<typeof conversationTokens.selection>;
};

function SettingsPanelContent({
  dependencies,
  props,
}: {
  dependencies: SettingsPanelDependencies;
  props: SettingsPanelProps;
}) {
  const { views, selectionService } = dependencies;
  const {
    snapshot,
    busy,
    invoke,
    initialSection = "general",
    onSectionChange,
    compactSidebar = false,
    className,
  } = props;

  const { t } = useTranslation();
  const selectedThreadId = useObservableState(selectionService, (state) => state.selectedThreadId);
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const View = views[section];
  const navigation = [
    { id: "general", icon: SlidersHorizontal, label: t("settings.general") },
    { id: "hosts", icon: ServerCog, label: t("hosts.title") },
    { id: "agents", icon: Bot, label: t("catalog.agents") },
    { id: "models", icon: BrainCircuit, label: t("catalog.models") },
    { id: "skills", icon: Box, label: t("catalog.skills") },
    { id: "tools", icon: PlugZap, label: t("catalog.tools") },
    { id: "toolchains", icon: PackagePlus, label: t("catalog.toolchains") },
    { id: "extensions", icon: Puzzle, label: t("catalog.extensions") },
  ] satisfies Array<{ id: SettingsSectionId; icon: typeof Bot; label: string }>;
  useEffect(() => setSection(initialSection), [initialSection]);
  return (
    <div
      className={cn(styles.catalogPanel, compactSidebar && styles.catalogPanelCompact, className)}
      data-settings-panel
      data-sidebar-compact={compactSidebar || undefined}
    >
      <Sidebar className={styles.catalogSidebar} aria-label={t("settings.title")}>
        <SidebarHeader className={styles.catalogSidebarHeader}>
          <div className={styles.catalogSidebarHeading}>
            <span className={styles.catalogSidebarMark} aria-hidden>
              <Settings2 size={16} />
            </span>
            <h1 className={styles.catalogSidebarTitle}>{t("settings.title")}</h1>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t("settings.title")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigation.map((item) => {
                  const Icon = item.icon;
                  const button = (
                    <SidebarMenuButton
                      isActive={section === item.id}
                      aria-label={compactSidebar ? item.label : undefined}
                      onClick={() => {
                        setSection(item.id);
                        onSectionChange?.(item.id);
                      }}
                    >
                      <Icon size={15} />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  );
                  return (
                    <SidebarMenuItem key={item.id}>
                      {compactSidebar ? (
                        <Tooltip
                          className={styles.catalogNavigationTooltip}
                          side="right"
                          content={item.label}
                        >
                          {button}
                        </Tooltip>
                      ) : (
                        button
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className={styles.catalogContent} data-settings-section={section}>
        <Suspense fallback={null}>
          <View
            snapshot={snapshot}
            busy={busy}
            invoke={invoke}
            selectedThreadId={selectedThreadId || snapshot.threads[0]?.id}
          />
        </Suspense>
      </div>
    </div>
  );
}

export const SettingsPanelFactory = create((dependsOn) => {
  const views = dependsOn(settingsTokens.settingsSections);
  const selectionService = dependsOn(conversationTokens.selection);
  const dependencies = { views, selectionService };
  return function SettingsPanel(props: SettingsPanelProps) {
    return createElement(SettingsPanelContent, { dependencies, props });
  };
}, "SettingsPanel");

export const SettingsPanel = (...args: Parameters<ServiceOf<typeof SettingsPanelFactory>>) =>
  createElement(useService(SettingsPanelFactory), ...args);
