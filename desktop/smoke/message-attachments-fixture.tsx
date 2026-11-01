import "@ovule/ui/styles.css";
import { createRoot } from "react-dom/client";
import { createRegistry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import workspaceTokens from "@ovule/workspace/workspace.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import { MessageParts } from "../features/message-parts/src/MessageParts";
import { ImagePart, FilePart } from "../features/message-parts/src/attachment-parts";
import type { MessagePartView } from "@ovule/shell-api";
const i18n = createInstance();
await i18n.init({
  lng: "en",
  resources: {
    en: {
      translation: {
        messageParts: {
          attachments: "Attachments",
          previewAttachment: "Preview {{name}}",
          openAttachment: "Open {{name}}",
          loadingAttachment: "Loading attachment…",
          imageUnavailable: "Image unavailable",
        },
      },
    },
  },
});
const events: string[] = [];
const revoked: string[] = [];
const revoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url) => {
  revoked.push(url);
  revoke(url);
};
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  ),
  (value) => value.charCodeAt(0),
);
const registry = createRegistry()
  .register(
    workspaceTokens.workspace,
    () =>
      ({
        api: async () => ({
          readMessageAttachment: async (id: string) => {
            if (id.startsWith("b")) throw new Error("Missing attachment");
            return [...png];
          },
        }),
        requestBrowserUse: (url: string) => events.push(`browser:${url}`),
        requestOfficeUse: (url: string) => events.push(`office:${url}`),
      }) as never,
  )
  .register(
    conversationTokens.messagePresentationRegistry,
    () =>
      ({
        subscribe: () => () => {},
        revision: () => 0,
        fileEditor: (target: string) => (target.endsWith(".pdf") ? { id: "office" } : undefined),
        renderer: (kind: string) => (kind === "image" ? ImagePart : FilePart),
      }) as never,
  );
const root = createRoot(document.getElementById("root")!);
root.render(
  <I18nextProvider i18n={i18n}>
    <ScopeProvider registry={registry}>
      <MessageParts
        streaming={false}
        parts={
          [
            {
              id: "image",
              kind: "image",
              url: `ovule-attachment:///${"a".repeat(64)}.png`,
              name: "screen.png",
              mediaType: "image/png",
              sizeBytes: 2048n,
            },
            {
              id: "file",
              kind: "file",
              url: "/workspace/report.pdf",
              name: "report.pdf",
              mediaType: "application/pdf",
              sizeBytes: 4096n,
            },
            {
              id: "remote",
              kind: "file",
              url: "https://example.test/archive.zip",
              name: "archive.zip",
              mediaType: "application/zip",
              sizeBytes: 8192n,
            },
            {
              id: "missing",
              kind: "image",
              url: `ovule-attachment:///${"b".repeat(64)}.png`,
              name: "missing.png",
              mediaType: "image/png",
            },
            { id: "unsafe", kind: "file", url: "javascript:alert(1)", name: "unsafe.txt" },
          ] as MessagePartView[]
        }
      />
    </ScopeProvider>
  </I18nextProvider>,
);
Object.assign(window, { attachmentTest: { events, revoked, unmount: () => root.unmount() } });
