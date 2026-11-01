import shellTokens from "@ovule/shell/shell.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Button } from "@ovule/ui/button";
import {
  AppWindow,
  ArrowLeft,
  Minus,
  Columns2,
  Settings2,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@ovule/ui/cn";
import { Tooltip } from "@ovule/ui/tooltip";

import styles from "./TitleBar.module.css";
import { useService } from "@ovule/ioc/react";
import frameworkTokens from "../framework.token";
import { useObservableState } from "@ovule/ioc/react";

type TitleBarDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
  layout: ServiceOf<typeof frameworkTokens.frameworkLayout>;
};

function TitleBarContent({
  dependencies,
  props,
}: {
  dependencies: TitleBarDependencies;
  props: {
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
  };
}) {
  const { shell, layout } = dependencies;
  const {
    title,
    workbenchOpen,
    onBackToChat,
    onToggleWorkbench,
    onOpenSettings,
    onOpenOnboarding,
    showWorkspaceActions = true,
    showSettings = true,
    showOnboarding = true,
    onboardingOpen = false,
    settingsOpen = false,
  } = props;

  const { t } = useTranslation();
  const [{ maximized, fullscreen }, setWindowState] = useState({
    maximized: false,
    fullscreen: false,
  });
  const togglingWorkbench = useObservableState(layout, (state) => state.workbenchTransitioning);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let frame = 0;
    const refresh = async () => {
      const request = ++generation;
      try {
        const info = await (await shell.window()).current();
        if (active && request === generation)
          setWindowState({ maximized: info.maximized, fullscreen: info.fullscreen });
      } catch (error) {
        if (active) console.error("Unable to read native window state", error);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => void refresh());
    };
    void refresh();
    // Native macOS fullscreen changes the viewport; it does not use the DOM
    // Fullscreen API. Also refresh when returning from another desktop Space.
    window.addEventListener("resize", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("fullscreenchange", schedule);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("fullscreenchange", schedule);
    };
  }, [shell]);
  const minimize = async () => {
    await (await shell.window()).minimize();
  };
  const toggleMaximize = async () => {
    const api = await shell.window();
    const current = await api.current();
    const info = current.maximized ? await api.restore() : await api.maximize();
    setWindowState({ maximized: info.maximized, fullscreen: info.fullscreen });
  };
  const close = async () => {
    await (await shell.window()).close();
  };
  const controls = !shell.macOS && (
    <div
      className={cn("window-controls", styles.windowControls)}
      data-platform={shell.macOS ? "macos" : "windows"}
    >
      <Tooltip className={styles.titlebarTooltip} side="bottom" content={t("titlebar.minimize")}>
        <Button
          variant="ghost"
          size="sm"
          className={cn(styles.actionButton, styles.windowButton)}
          aria-label={t("titlebar.minimize")}
          onClick={() => void minimize()}
        >
          <Minus size={14} />
        </Button>
      </Tooltip>
      <Tooltip
        className={styles.titlebarTooltip}
        side="bottom"
        content={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
      >
        <Button
          variant="ghost"
          size="sm"
          className={cn(styles.actionButton, styles.windowButton)}
          aria-label={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          onClick={() => void toggleMaximize()}
        >
          {maximized ? <AppWindow size={12} /> : <Square size={12} />}
        </Button>
      </Tooltip>
      <Tooltip className={styles.titlebarTooltip} side="bottom" content={t("titlebar.close")}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("titlebar.close")}
          className={cn(styles.actionButton, styles.windowButton, styles.windowClose)}
          onClick={() => void close()}
        >
          <X />
        </Button>
      </Tooltip>
    </div>
  );
  return (
    <header className={cn("titlebar", styles.root)}>
      <div className={styles.leading}>
        {shell.macOS && !fullscreen ? (
          <div
            className={styles.macTrafficLightsSpace}
            data-native-traffic-lights="reserved"
            aria-hidden="true"
          />
        ) : (
          <div className={styles.slogan} aria-label="Ovule">
            <span className={styles.sloganMark}>O</span>
            <strong className={styles.sloganTitle}>Ovule</strong>
          </div>
        )}
      </div>
      <div className={styles.drag}>
        {title && <strong className={styles.dragTitle}>{title}</strong>}
      </div>
      <div className={styles.actions}>
        <div className={styles.titlebarTools}>
          {onBackToChat &&
            Number(onboardingOpen) + Number(settingsOpen) + Number(workbenchOpen) >= 2 && (
              <Tooltip side="bottom" content={t("titlebar.backToChat")}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(styles.actionButton, styles.toolButton)}
                  aria-label={t("titlebar.backToChat")}
                  onClick={onBackToChat}
                >
                  <ArrowLeft size={16} />
                </Button>
              </Tooltip>
            )}
          {showOnboarding && (
            <Tooltip
              className={styles.titlebarTooltip}
              side="bottom"
              content={t(onboardingOpen ? "titlebar.closeOnboarding" : "titlebar.onboarding")}
            >
              <Button
                variant="ghost"
                size="sm"
                className={cn(styles.actionButton, styles.toolButton)}
                aria-label={t(onboardingOpen ? "titlebar.closeOnboarding" : "titlebar.onboarding")}
                aria-pressed={onboardingOpen}
                data-active={onboardingOpen || undefined}
                onClick={onOpenOnboarding}
              >
                <Sparkles size={16} />
              </Button>
            </Tooltip>
          )}
          {showSettings && (
            <Tooltip
              className={styles.titlebarTooltip}
              side="bottom"
              content={t("titlebar.settings")}
            >
              <Button
                variant="ghost"
                size="sm"
                className={cn(styles.actionButton, styles.toolButton)}
                aria-label={t("titlebar.settings")}
                data-settings-toggle
                aria-pressed={settingsOpen}
                data-active={settingsOpen || undefined}
                onClick={onOpenSettings}
              >
                <Settings2 size={16} />
              </Button>
            </Tooltip>
          )}
          {showSettings && showWorkspaceActions && (
            <span className={styles.actionSeparator} data-titlebar-separator aria-hidden="true" />
          )}
          {showWorkspaceActions && (
            <Tooltip
              className={styles.titlebarTooltip}
              side="bottom"
              align="end"
              content={workbenchOpen ? t("titlebar.hideWorkbench") : t("titlebar.showWorkbench")}
            >
              <Button
                variant="ghost"
                size="sm"
                className={cn(styles.actionButton, styles.toolButton)}
                aria-label={
                  workbenchOpen ? t("titlebar.hideWorkbench") : t("titlebar.showWorkbench")
                }
                aria-pressed={workbenchOpen}
                data-active={workbenchOpen || undefined}
                disabled={togglingWorkbench}
                onClick={onToggleWorkbench}
              >
                <Columns2 size={16} />
              </Button>
            </Tooltip>
          )}
        </div>
        {controls}
      </div>
    </header>
  );
}

export const TitleBarFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const layout = dependsOn(frameworkTokens.frameworkLayout);
  const dependencies = { shell, layout };
  return function TitleBar(props: {
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
  }) {
    return createElement(TitleBarContent, { dependencies, props });
  };
}, "TitleBar");

export const TitleBar = (...args: Parameters<ServiceOf<typeof TitleBarFactory>>) =>
  createElement(useService(TitleBarFactory), ...args);
