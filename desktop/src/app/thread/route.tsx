import conversationTokens from "@ovule/conversation/conversation.token";
import shellTokens from "@ovule/shell/shell.token";
import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import settingsTokens from "@ovule/settings/settings.token";
import { useTranslation } from "react-i18next";

import { Suspense, useEffect } from "react";
import { useService, useServiceAsync } from "@ovule/ioc/react";

import { RouteServicesProvider } from "@/providers";
import { ThreadApp } from "./ThreadApp";
import { registerThreadServices } from "./services";

export default function ThreadRoute() {
  return (
    <RouteServicesProvider register={registerThreadServices}>
      <ThreadApp />
      <Suspense fallback={null}>
        <ExtensionMessageBlocks />
      </Suspense>
    </RouteServicesProvider>
  );
}

function ExtensionMessageBlocks() {
  const { initializeExtensionMessageBlocks } = useService(conversationTokens.messageRouteRuntime);
  const { i18n } = useTranslation();
  const shell = useService(shellTokens.shell);
  const handoff = useService(messagePartsTokens.handoffProtocol);
  const registry = useService(conversationTokens.messagePresentationRegistry);
  const catalog = useServiceAsync(settingsTokens.extensionCatalog);
  useEffect(() => {
    void initializeExtensionMessageBlocks(registry, catalog, i18n, shell, handoff).catch(
      console.error,
    );
  }, [catalog, registry]);
  return null;
}
