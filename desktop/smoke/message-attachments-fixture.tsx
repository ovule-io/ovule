import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import { AttachmentPreviewDialog } from "../features/message-parts/src/AttachmentPreviewDialog";
import "@ovule/ui/styles.css";
import { GlobalDialogHost } from "../features/conversation/src/message-telemetry/GlobalDialogHost";
import { handleRootRequest } from "../features/conversation/src/ThreadSurface";
import { MessageActions } from "../features/conversation/src/messages/MessageActions";
import shellTokens from "@ovule/shell/shell.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import settingsTokens from "@ovule/settings/settings.token";
import en from "../features/i18n/src/locales/en.json";
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
      translation: en,
    },
  },
});
const child = location.search === "?child";
if (child) document.documentElement.dataset.surface = "thread";
const events: string[] = [];
const saves: { path: string; contents: number[] }[] = [];
const requests: unknown[] = [];
const shell = {
  copyText: async (text: string) => {
    events.push(`copy:${text}`);
    return true;
  },
  dialog: async () => ({
    saveFile: async (options: { defaultPath: string }, contents: number[]) => {
      saves.push({ path: options.defaultPath, contents });
      return options.defaultPath;
    },
  }),
  requestRoot: async (channel: string, payload: unknown) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const receive = (event: MessageEvent) => {
        if (
          event.origin !== location.origin ||
          event.source !== parent ||
          event.data.requestId !== requestId
        )
          return;
        window.removeEventListener("message", receive);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      window.addEventListener("message", receive);
      parent.postMessage({ type: "app-request", requestId, channel, payload }, location.origin);
    });
  },
};
if (!child)
  window.addEventListener("message", async (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== document.querySelector("iframe")?.contentWindow ||
      event.data?.type !== "app-request"
    )
      return;
    requests.push(event.data);
    try {
      const result = await handleRootRequest(
        event.data.channel,
        event.data.payload,
        {} as never,
        () => {},
      );
      (event.source as Window).postMessage(
        { requestId: event.data.requestId, result },
        event.origin,
      );
    } catch (error) {
      (event.source as Window).postMessage(
        { requestId: event.data.requestId, error: String(error) },
        event.origin,
      );
    }
  });
const revoked: string[] = [];
const revoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url) => {
  revoked.push(url);
  revoke(url);
};
const canvas = document.createElement("canvas");
canvas.width = 320;
canvas.height = 200;
const context = canvas.getContext("2d")!;
context.fillStyle = "#1c4b70";
context.fillRect(0, 0, 320, 200);
context.fillStyle = "#c2e6f7";
context.fillRect(24, 24, 272, 152);
context.fillStyle = "#1c4b70";
context.font = "18px sans-serif";
context.fillText("Screenshot preview", 48, 110);
const png = Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]), (value) =>
  value.charCodeAt(0),
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
const idleState = { snapshot: undefined, pending: 0, busy: false };
const idle = {
  current: () => idleState,
  subscribe: () => () => {},
};
for (const token of [
  conversationTokens.conversationState,
  workflowTokens.workflowState,
  settingsTokens.agentsState,
  settingsTokens.modelsState,
])
  registry.register(token, () => idle as never);
registry.register(shellTokens.shell, () => shell as never);
registry.register(messagePartsTokens.attachmentPreview, () => AttachmentPreviewDialog);
const root = createRoot(document.getElementById("root")!);
root.render(
  <I18nextProvider i18n={i18n}>
    <ScopeProvider registry={registry}>
      {child ? (
        <>
          <MessageActions text="A message to copy and save" />
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
        </>
      ) : (
        <>
          <aside style={{ position: "fixed", inset: "0 auto 0 0", width: 200, background: "#eee" }}>
            Sidebar
          </aside>
          <iframe
            title="Conversation"
            src="/?child"
            style={{
              position: "absolute",
              top: 36,
              left: 200,
              width: "calc(100% - 200px)",
              height: "calc(100% - 36px)",
              border: 0,
            }}
          />
          <GlobalDialogHost />
        </>
      )}
    </ScopeProvider>
  </I18nextProvider>,
);
Object.assign(window, {
  attachmentTest: { events, saves, requests, revoked, unmount: () => root.unmount() },
});
