import type { ReactNode } from "react";
export interface RouteRuntime {
  TitleBar: (arg0: {
    title: string;
    workbenchOpen: boolean;
    onBackToChat?(): void;
    onToggleWorkbench(): void;
    onOpenSettings(): void;
    onOpenOnboarding(): void;
    showWorkspaceActions?: boolean;
    showSettings?: boolean;
    showOnboarding?: boolean;
    onboardingOpen?: boolean;
    settingsOpen?: boolean;
  }) => ReactNode;
}
