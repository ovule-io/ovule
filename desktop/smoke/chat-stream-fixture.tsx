import { createAgentApprovals } from "../features/shell/src/agent-approvals";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createRegistry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import shellTokens from "@ovule/shell/shell.token";
import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import { createMessagePresentationRegistry } from "../features/conversation/src/messages/service";
import { registerDefaultMessageRenderers } from "../features/message-parts/src/renderer-registry";
import { MessageParts } from "../features/message-parts/src/MessageParts";
import { MessageList } from "../features/conversation/src/messages/MessageList";
import type { ThreadMessageView } from "@ovule/shell-api";
import "@ovule/ui/styles.css";
import "../src/app/tailwind.css";
import composerStyles from "../features/conversation/src/composer/MessageComposer.module.css";
import en from "../features/i18n/src/locales/en.json";
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
const presentation = createMessagePresentationRegistry();
registerDefaultMessageRenderers(presentation);
const opened: string[] = [];
const approvalEvents = new EventTarget();
Object.assign(window, { tuffite: approvalEvents });
const agentApprovals = createAgentApprovals();
agentApprovals.install();
const registry = createRegistry()
  .register(conversationTokens.messagePresentationRegistry, () => presentation)
  .register(messagePartsTokens.runtime, () => ({ View: MessageParts }) as never)
  .register(workflowTokens.presentation, () => ({ Graph: () => null }) as never)
  .register(
    workspaceTokens.workspace,
    () => ({ requestBrowserUse: (url: string) => opened.push(url) }) as never,
  )
  .register(
    shellTokens.shell,
    () => ({ dialog: async () => ({ saveFile: async () => undefined }), agentApprovals }) as never,
  );
const answer =
  "A streamed answer with citation [1](https://example.test/docs).\n\n```xml\n<node>safe &lt;content&gt;</node>\n```\n\n";
function Fixture() {
  const [threadId, setThreadId] = useState("thread");
  const [messages, setMessages] = useState<ThreadMessageView[]>([
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `old-${index}`,
      role: index % 2 ? "assistant" : "user",
      status: "complete",
      createdAt: index,
      parts: [
        {
          id: `old-${index}-text`,
          kind: "markdown",
          text: `Earlier turn ${index}. ${"History content. ".repeat(25)}`,
        },
      ],
    })),
    {
      id: "question",
      attemptId: "fixture-attempt",
      role: "user",
      status: "complete",
      createdAt: 10,
      parts: [{ id: "question-text", kind: "markdown", text: "Check the workspace" }],
    },
    {
      id: "reply",
      attemptId: "fixture-attempt",
      role: "assistant",
      status: "streaming",
      createdAt: 11,
      parts: [
        {
          id: "thought",
          kind: "thinking",
          dataJson: JSON.stringify({ text: "Inspecting **workspace**." }),
        },
        {
          id: "call",
          kind: "tool",
          dataJson: JSON.stringify({
            name: "workspace.check",
            state: "running",
            input: { command: "cargo check" },
          }),
        },
        { id: "text", kind: "markdown", text: answer },
        {
          id: "citation",
          kind: "citation",
          dataJson: JSON.stringify({
            url: "https://example.test/reference",
            title: "Reference source",
            description: "A safe source preview.",
          }),
        },
      ],
    },
  ] as ThreadMessageView[]);
  Object.assign(window, {
    chatTest: {
      append: (text: string, done = false) =>
        setMessages((current) =>
          current.map((message) =>
            message.id === "reply"
              ? {
                  ...message,
                  status: done ? "complete" : "streaming",
                  parts: message.parts.map((part) =>
                    part.id === "text"
                      ? { ...part, text: part.text + text }
                      : part.id === "call"
                        ? {
                            ...part,
                            dataJson: JSON.stringify({
                              name: "workspace.check",
                              state: done ? "completed" : "running",
                              input: { command: "cargo check" },
                              ...(done
                                ? {
                                    output: {
                                      stdout: "Build passed. <script>never execute</script>",
                                    },
                                  }
                                : {}),
                            }),
                          }
                        : part,
                  ),
                }
              : message,
          ),
        ),
      approval: (kind: string) => {
        const request = {
          kind,
          requestId: "a".repeat(32),
          attemptId: "fixture-attempt",
          tool: "fixture.tool",
          arguments: { action: "test" },
          automaticAllowed: false,
        };
        Object.assign(window, { approvalPending: kind === "request" ? [request] : [] });
        return approvalEvents.dispatchEvent(
          new CustomEvent("channel", {
            detail: {
              channel: "ovule:agent-approval",
              data: new TextEncoder().encode(JSON.stringify(request)),
            },
          }),
        );
      },
      reanchor: () =>
        setMessages((current) =>
          current.map((message) =>
            message.id === "question" ? { ...message, id: "new-question" } : message,
          ),
        ),
      opened,
      statuses(mode: "cancelled" | "legacy" | "tools") {
        setThreadId(`status-${mode}`);
        const tools = [
          {
            name: "fixture.command",
            state: "failed",
            failureKind: "Process",
            output: { exit_code: 1, stderr: "Command did not succeed" },
          },
          {
            name: "fixture.timeout",
            state: "failed",
            failureKind: "Timeout",
            error: "Approval deadline elapsed",
          },
          {
            name: "fixture.backend",
            state: "failed",
            failureKind: "Backend",
            error: "Invalid path",
          },
          { name: "fixture.ok", state: "completed", output: { exit_code: 0, stdout: "Done" } },
        ].map((data, index) => ({
          id: `status-tool-${index}`,
          kind: "tool",
          dataJson: JSON.stringify(data),
        }));
        setMessages([
          {
            id: "status-reply",
            role: mode === "legacy" ? "system" : "assistant",
            status: mode === "tools" ? "complete" : mode === "legacy" ? "error" : "cancelled",
            createdAt: 1,
            parts: [
              {
                id: "status-text",
                kind: "markdown",
                text:
                  mode === "legacy"
                    ? "Agent Worker was cancelled before it started"
                    : "Already checked the application bundle.",
              },
              ...tools,
              ...(mode === "cancelled"
                ? [{ id: "status-notice", kind: "notice", text: "Generation stopped" }]
                : []),
            ],
          },
        ] as ThreadMessageView[]);
      },
      composerClass: composerStyles.inputGroup,
      history(count: number, nextThread = "history") {
        setThreadId(nextThread);
        setMessages(
          Array.from({ length: count }, (_, index) => ({
            id: `${nextThread}-${index}`,
            role: index % 2 ? "assistant" : "user",
            status: "complete",
            createdAt: index,
            parts: [
              {
                id: `${nextThread}-${index}-text`,
                kind: "markdown",
                text: `Turn ${index}. ${"History content. ".repeat(25)}`,
              },
            ],
          })) as ThreadMessageView[],
        );
      },
    },
  });
  return (
    <MessageList
      thread={{ id: threadId, agent: "Ovule" } as never}
      goals={[]}
      workflowNodes={[]}
      workflowAttempts={[]}
      messages={messages}
      busy={messages.at(-1)?.status === "streaming"}
      showMessageTelemetry={async () => {}}
      openNodeThread={() => {}}
      openWorkflow={() => {}}
    />
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <ScopeProvider registry={registry}>
      <Fixture />
    </ScopeProvider>
  </I18nextProvider>,
);
