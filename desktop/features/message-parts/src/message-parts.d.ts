import type { ComponentType } from "react";
import type { MessagePartView, ExtensionCatalogView } from "@ovule/shell-api";
import type { i18n } from "i18next";
import type { MessagePresentationRegistry } from "@ovule/conversation/messages/message-list";
import type { ShellService } from "@ovule/shell/shell";
import type { HandoffProtocolService } from "@ovule/message-parts/handoff/protocol";
export type MessagePartsProps = {
  renderBlocks?: boolean;
  onCompose?(prompt: string): void;
  parts: MessagePartView[];
  streaming: boolean;
};
export type MessagePartsRuntime = {
  View: ComponentType<MessagePartsProps>;
  initialize(
    registry: MessagePresentationRegistry,
    catalog: ExtensionCatalogView,
    i18n: i18n,
    shell: Pick<ShellService, "mountIsolated">,
    handoff: HandoffProtocolService,
  ): Promise<void>;
  registerDefaults(registry: MessagePresentationRegistry): void;
};
