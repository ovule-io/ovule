import tokens from "./message-parts.token";
import type { Register } from "@ovule/ioc";
import { MessageParts } from "./MessageParts";
import { initializeExtensionMessageBlocks } from "./extension-blocks";
import { registerDefaultMessageRenderers } from "./renderer-registry";
export default function registerMessageParts(register: Register): void {
  register(tokens.runtime, () => ({
    View: MessageParts,
    initialize: initializeExtensionMessageBlocks,
    registerDefaults: registerDefaultMessageRenderers,
  }));
}
