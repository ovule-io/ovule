import { IframeMessagePart } from "./iframe-message-part";
import { createElement } from "react";
import { IsolatedMessagePart } from "./isolated-message-part";
import type { MessagePresentationRegistry } from "@ovule/conversation/messages/message-list";
import { registerHostChannelSetupBlock } from "./HostChannelSetupBlock";
import { registerHostHumanHandoffBlock } from "./HostHumanHandoffBlock";
import { WebComponentMessagePart } from "./web-component-part";
import { registerMessagePartRenderer } from "./renderer-registry";

type ScopedRegistry = {
  extensionId: string;
  registry: CustomElementRegistry;
  scoped: boolean;
};

const extensionRegistries = new Map<string, ScopedRegistry>();

export async function initializeExtensionMessageBlocks(
  registry: MessagePresentationRegistry,
  catalog: import("@ovule/shell-api").ExtensionCatalogView,
  i18n: import("i18next").i18n,
  shell: Pick<import("@ovule/shell/shell").ShellService, "mountIsolated">,
  handoff: import("@ovule/message-parts/handoff/protocol").HandoffProtocolService,
): Promise<void> {
  registry.replaceFileEditors(catalog.fileEditors);
  for (const contribution of catalog.messageBlocks) {
    try {
      if (contribution.uiType === "iframe") {
        registerMessagePartRenderer(registry, contribution.kind, (props) => (
          <IframeMessagePart {...props} />
        ));
        continue;
      }
      if (!contribution.hostRenderer) {
        registerMessagePartRenderer(registry, contribution.kind, (props) => (
          <IsolatedMessagePart {...props} contribution={contribution} mount={shell.mountIsolated} />
        ));
        continue;
      }
      const scoped =
        extensionRegistries.get(contribution.extensionId) ??
        createScopedRegistry(contribution.extensionId);
      const declaredTag = contribution.tag ?? "ovule-channel-setup";
      const runtimeTag = scoped.scoped
        ? declaredTag
        : fallbackTag(contribution.extensionId, declaredTag);
      if (contribution.hostRenderer === "channel-setup") {
        registerHostChannelSetupBlock(scoped.registry, runtimeTag, i18n);
      } else if (contribution.hostRenderer === "human-handoff") {
        registerHostHumanHandoffBlock(scoped.registry, runtimeTag, i18n, handoff);
      }
      if (!scoped.registry.get(runtimeTag)) {
        throw new Error(`Message Block module did not register ${runtimeTag}`);
      }
      registerMessagePartRenderer(registry, contribution.kind, ({ part, streaming, onCompose }) => (
        <WebComponentMessagePart
          registry={scoped.registry}
          extensionId={contribution.extensionId}
          scoped={scoped.scoped}
          styleUrl={contribution.styleUrl ?? undefined}
          tag={runtimeTag}
          part={part}
          streaming={streaming}
          onCompose={onCompose}
        />
      ));
    } catch (error) {
      console.error(`Failed to load Message Block ${contribution.kind}`, error);
    }
  }
}

function createScopedRegistry(extensionId: string): ScopedRegistry {
  try {
    const registry = new CustomElementRegistry();
    const probeTag = `ovule-scope-${hashToken(extensionId)}`;
    const Probe = class extends HTMLElement {};
    registry.define(probeTag, Probe);
    const host = document.createElement("div");
    const root = host.attachShadow({
      mode: "open",
      customElementRegistry: registry,
    });
    const probe = document.createElement(probeTag, {
      customElementRegistry: registry,
    });
    root.append(probe);
    if (probe instanceof Probe) {
      const scoped = { extensionId, registry, scoped: true };
      extensionRegistries.set(extensionId, scoped);
      return scoped;
    }
  } catch {
    // Older Chromium uses a unique global runtime tag while keeping CSS in a ShadowRoot.
  }
  const scoped = { extensionId, registry: customElements, scoped: false };
  extensionRegistries.set(extensionId, scoped);
  return scoped;
}

function fallbackTag(extensionId: string, declaredTag: string): string {
  return `ovule-${hashToken(extensionId)}-${hashToken(declaredTag)}`;
}

function hashToken(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
