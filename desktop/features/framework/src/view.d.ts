import type { ComponentType, ReactNode } from "react";

export type FrameworkViewProps = {
  onOpenThreadSwitcher(): void;
  onNewThread(): void;
  setupOpen?: boolean;
  setup?: ReactNode;
};

export type ContentViewProps = Record<string, never>;

export type FrameworkViewTokenValue = ComponentType<FrameworkViewProps>;

export type ContentViewTokenValue = ComponentType<ContentViewProps>;
