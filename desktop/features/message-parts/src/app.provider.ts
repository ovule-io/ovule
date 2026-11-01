import { lazy } from "react";
import messagePartsTokens from "./message-parts.token";
import type { Register } from "@ovule/ioc";
import { encodeHumanHandoff } from "./handoff/protocol-codec";
import { parseHumanHandoff } from "./handoff/protocol-codec";
import { value } from "@ovule/ioc";
export default function register(register: Register): void {
  register(
    messagePartsTokens.attachmentPreview,
    value(
      lazy(() =>
        import("./AttachmentPreviewDialog").then((module) => ({
          default: module.AttachmentPreviewDialog,
        })),
      ),
    ),
  );
  registerHumanHandoff(register);
  registerRoute(register);
}

function registerHumanHandoff(register: Register): void {
  register(messagePartsTokens.handoffProtocol, value({ encodeHumanHandoff, parseHumanHandoff }));
}

function registerRoute(register: Register): void {
  register(messagePartsTokens.routeRuntime, value({ encodeHumanHandoff }));
}
