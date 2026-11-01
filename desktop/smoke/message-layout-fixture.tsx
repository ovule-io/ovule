import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createRegistry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import conversationTokens from "@ovule/conversation/conversation.token";
import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { ThinkingPart } from "../features/message-parts/src/thinking-part";
import { PaneTabIndicators } from "../features/panes/src/toolbar/PaneTabIndicators";
import { useState } from "react";
import { Message, MessageContent } from "@ovule/ui/message";
import partStyles from "../features/message-parts/src/MessageParts.module.css";
import conversationStyles from "../features/conversation/src/messages/ConversationPane.module.css";
import "@ovule/ui/theme.css";
import "@ovule/ui/styles.css";
import "../src/app/tailwind.css";
import en from "../features/i18n/src/locales/en.json";
const i18n = createInstance();
await i18n.init({
  lng: "en",
  resources: {
    en: {
      translation: en,
    },
  },
});
const registry = createRegistry()
  .register(
    shellTokens.shell,
    () =>
      ({
        dialog: async () => ({
          saveFile: async (options: unknown, contents: number[]) => {
            if (typeof window !== "undefined")
              Object.assign(window, { savedCode: { options, contents } });
            return "/tmp/code.xml";
          },
        }),
      }) as never,
  )
  .register(
    conversationTokens.messagePresentationRegistry,
    () => ({ fileEditor: () => undefined }) as never,
  )
  .register(workspaceTokens.workspace, () => ({}) as never);
const text = `Fonts: ${"very-long-font-name-".repeat(30)}\n\nFor the content types:\n\n\`\`\`xml\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n<Override PartName="/xl/workbook.xml" ContentType="${"very-long-xml-attribute-".repeat(50)}"/>\n</Types>\n\`\`\``;
function Fixture() {
  const [tabs, setTabs] = useState(
    [1, 2, 3, 4].map((id) => ({
      id: `tab-${id}`,
      kind: "browser" as const,
      title: `Tab ${id}`,
      requestVersion: 0,
      lastVisited: id,
    })),
  );
  return (
    <>
      <header style={{ height: 56, position: "relative", zIndex: 2 }}>
        <PaneTabIndicators
          tabs={tabs}
          onSelect={(id) =>
            setTabs((current) =>
              current.map((tab) =>
                tab.id === id
                  ? { ...tab, lastVisited: Math.max(...current.map((tab) => tab.lastVisited)) + 1 }
                  : tab,
              ),
            )
          }
        />
      </header>
      <Message from="assistant" style={{ padding: 20 }}>
        <MessageContent className={conversationStyles.messageContent}>
          <article className={conversationStyles.messageCard} data-testid="message-card">
            <div className={partStyles.messageParts}>
              <ThinkingPart
                part={{ id: "thinking", kind: "thinking", dataJson: JSON.stringify({ text }) }}
                streaming
              />
            </div>
          </article>
        </MessageContent>
      </Message>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <I18nextProvider i18n={i18n}>
    <ScopeProvider registry={registry}>
      <Fixture />
    </ScopeProvider>
  </I18nextProvider>,
);
