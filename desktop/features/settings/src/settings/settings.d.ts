import type { ViewData } from "./view-data";
import type { ComponentType } from "react";
import type { OnboardingStatus } from "@ovule/shell-api";
import type { WorkspaceOperation } from "./operations";

export type SettingsSectionId =
  | "general"
  | "hosts"
  | "agents"
  | "models"
  | "skills"
  | "tools"
  | "toolchains"
  | "extensions";

export type SettingsSectionProps = {
  snapshot: ViewData;
  busy: boolean;
  invoke(operation: WorkspaceOperation): Promise<boolean>;
  selectedThreadId?: string;
};

export type SettingsPanelProps = SettingsSectionProps & {
  initialSection?: SettingsSectionId;
  onSectionChange?(section: SettingsSectionId): void;
  compactSidebar?: boolean;
  className?: string;
};

export type OllamaSetupViewProps = {
  status?: OnboardingStatus;
  onRefresh?(): Promise<void>;
  onError?(message: string): void;
};

export type SettingsPanelViewTokenValue = ComponentType<SettingsPanelProps>;

export type SettingsSectionsTokenValue = Record<
  SettingsSectionId,
  ComponentType<SettingsSectionProps>
>;

export type OllamaSetupViewTokenValue = ComponentType<OllamaSetupViewProps>;

export type PreferencesSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type HostsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type AgentsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type ModelsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type SkillsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type ToolsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type ToolchainsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type ExtensionsSettingsViewTokenValue = ComponentType<SettingsSectionProps>;

export type DesktopPermissionsViewTokenValue = ComponentType;
