import branding from "../../../branding.json";
import settingsTokens from "@ovule/settings/settings.token";
import i18nTokens from "@ovule/i18n/i18n.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import shellTokens from "@ovule/shell/shell.token";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate, useRouteError } from "react-router";
import "@fontsource-variable/geist";
import "@ovule/ui/styles.css";
import "./tailwind.css";

import type { TuffiteMessageEvent } from "@ovule/shell/explorer";
import { useTranslation } from "react-i18next";
import type { i18n as I18n } from "i18next";
import { AppProviders } from "./providers";
import { useService } from "@ovule/ioc/react";
export { HydrateFallback } from "./HydrateFallback";

type BoundaryState = { error?: Error };

function applyAppearance(i18n: I18n, theme?: string | null, language?: string | null) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }
  if ((language === "en" || language === "zh-CN") && i18n.language !== language)
    void i18n.changeLanguage(language);
}

function RouteRuntime() {
  const { i18n } = useTranslation();
  const useThemeMode = useService(settingsTokens.themeModeHook);
  const useLanguageMode = useService(i18nTokens.languageModeHook);
  useThemeMode();
  useLanguageMode();
  const selectionService = useService(conversationTokens.selection);
  const shell = useService(shellTokens.shell);
  const routeLocation = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const synchronizeExternalNavigation = () =>
      void navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true });
    window.addEventListener("ovule:route", synchronizeExternalNavigation);
    return () => window.removeEventListener("ovule:route", synchronizeExternalNavigation);
  }, [navigate]);

  useEffect(() => {
    const search = new URLSearchParams(routeLocation.search);
    const surface = routeLocation.pathname.split("/").filter(Boolean).at(-1) || "main";
    document.documentElement.dataset.surface = surface;
    if (surface !== "main") {
      const threadId = search.get("thread");
      if (threadId) selectionService.selectThread(threadId);
      else selectionService.clearThread();
    }
    applyAppearance(i18n, search.get("theme"), search.get("language"));
  }, [routeLocation.pathname, routeLocation.search, selectionService, i18n]);

  useEffect(() => {
    const tuffite = shell.messageApi();
    const sync = (event: TuffiteMessageEvent) => {
      const message = event.data as { type?: string; theme?: string; language?: string };
      if (message?.type === "appearance.sync")
        applyAppearance(i18n, message.theme, message.language);
    };
    tuffite?.addEventListener("message", sync);
    return () => tuffite?.removeEventListener("message", sync);
  }, [shell, i18n]);

  return <Outlet />;
}

class FatalBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = {};

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Ovule render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error)
      return (
        <FatalScreen
          title={`${branding.displayName} could not render this page`}
          error={this.state.error}
        />
      );
    return this.props.children;
  }
}

function FatalScreen({ title, error }: { title: string; error: unknown }) {
  const detail =
    error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
  return (
    <main className="boot-screen">
      <section className="fatal-screen">
        <h1>{title}</h1>
        <p>{"The application could not start. Error details:"}</p>
        <pre>{detail}</pre>
      </section>
    </main>
  );
}

export default function Root() {
  return (
    <FatalBoundary>
      <AppProviders>
        <RouteRuntime />
        <ScrollRestoration nonce="ovule-spa" />
      </AppProviders>
    </FatalBoundary>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return <FatalScreen title={`${branding.displayName} could not render this page`} error={error} />;
}
