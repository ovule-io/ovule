import { expect, test } from "bun:test";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { createRegistry } from "@ovule/ioc-container";
import { ScopeProvider } from "@ovule/ioc-container/react";
import conversationTokens from "@ovule/conversation/conversation.token";
import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { ThinkingPart } from "../features/message-parts/src/thinking-part";
import { MessageParts } from "../features/message-parts/src/MessageParts";
import { MarkdownPart } from "../features/message-parts/src/markdown-part";
import { IframeMessagePart } from "../features/message-parts/src/iframe-message-part";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: {} } } });

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
    () =>
      ({
        fileEditor: () => undefined,
        subscribe: () => () => {},
        revision: () => 0,
        renderer: (kind: string) =>
          ({ markdown: MarkdownPart, thinking: ThinkingPart, "interactive-ui": IframeMessagePart })[
            kind
          ],
      }) as never,
  )
  .register(workspaceTokens.workspace, () => ({}) as never);

function render(text: string, streaming = true) {
  const part = {
    kind: "thinking",
    dataJson: JSON.stringify({ text }),
  } as MessagePartRendererProps["part"];
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ScopeProvider registry={registry}>
        <ThinkingPart part={part} streaming={streaming} />
      </ScopeProvider>
    </I18nextProvider>,
  );
}
test("thinking streams formatted Markdown and incomplete code fences", () => {
  const partial = render("**Plan**\n\n```xml\n<node>");
  expect(partial).toContain('data-streamdown="strong">Plan</span>');
  expect(partial).toContain("&lt;node&gt;");
  expect(partial).not.toContain("**Plan**");
  const complete = render("**Done**\n\n```xml\n<node/>\n```", false);
  expect(complete).toContain('data-streamdown="strong">Done</span>');
  expect(complete).toContain("&lt;node/&gt;");
});

test("code controls remain available for unknown and unlabelled languages", () => {
  for (const language of ["", "unknown-language"]) {
    const html = render(`\`\`\`${language}\n<safe>& raw code\n\`\`\``, false);
    expect(html).toContain('data-streamdown="code-block-copy-button"');
    expect(html).toContain('aria-label="messageList.codeSave"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("&lt;safe&gt;&amp; raw code");
  }
});

test("completed answers show one title and full body outside the thinking trace", () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ScopeProvider registry={registry}>
        <MessageParts
          streaming={false}
          renderBlocks
          parts={[
            { id: "thought", kind: "thinking", dataJson: JSON.stringify({ text: "Plan" }) },
            {
              id: "answer",
              kind: "markdown",
              text: `# Unique title\n\n${"Body paragraph. ".repeat(150)}\n\nFinal sentence.`,
            },
          ]}
        />
      </ScopeProvider>
    </I18nextProvider>,
  );
  expect(html.match(/Unique title/g)).toHaveLength(1);
  expect(html.match(/data-slot="trace"/g)).toHaveLength(1);
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("<details");
  expect(html.indexOf("Final sentence.")).toBeGreaterThan(html.indexOf("Plan"));
  expect(html).not.toContain("messageList.showDetails");
});

test("thinking trace expands while running and keeps completed content mounted", () => {
  const running = render("Current reasoning");
  expect(running).toContain('data-slot="trace-collapsible-trigger"');
  expect(running).toContain('aria-expanded="true"');
  expect(running).toContain('data-status="running"');
  const completed = render("Completed reasoning", false);
  expect(completed).toContain('aria-expanded="false"');
  expect(completed).toContain("Completed reasoning");
  expect(completed).not.toContain('data-status="running"');
});

test("assistant envelopes use the sandbox renderer while user code stays code", () => {
  const text =
    '```ovule-block\n{"id":"card","kind":"interactive-ui","data":{"html":"<button>Apply</button>"}}\n```';
  for (const renderBlocks of [true, false]) {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ScopeProvider registry={registry}>
          <MessageParts
            streaming={false}
            renderBlocks={renderBlocks}
            parts={[{ id: "answer", kind: "markdown", text }]}
          />
        </ScopeProvider>
      </I18nextProvider>,
    );
    expect(html.includes('data-renderer="sandbox-iframe"')).toBe(renderBlocks);
    expect(html.includes('data-streamdown="code-block"')).toBe(!renderBlocks);
  }
});
