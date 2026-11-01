import i18nTokens from "@ovule/i18n/i18n.token";
import { useService } from "@ovule/ioc/react";
import { I18nextProvider } from "react-i18next";
import { useMemo, type PropsWithChildren } from "react";
import { createRegistry, type Registry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { registerDesktopServices } from "./services";

export function AppProviders({ children }: PropsWithChildren) {
  const registry = useMemo(() => registerDesktopServices(createRegistry()), []);
  return (
    <ScopeProvider registry={registry}>
      <TranslationProvider>{children}</TranslationProvider>
    </ScopeProvider>
  );
}
export function RouteServicesProvider({
  register,
  children,
}: PropsWithChildren<{
  register(registry: Registry): Registry;
}>) {
  const registry = useMemo(() => register(createRegistry()), [register]);
  return <ScopeProvider registry={registry}>{children}</ScopeProvider>;
}

function TranslationProvider({ children }: PropsWithChildren) {
  const service = useService(i18nTokens.i18n);
  return <I18nextProvider i18n={service.instance}>{children}</I18nextProvider>;
}
