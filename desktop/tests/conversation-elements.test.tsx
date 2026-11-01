import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { ConversationMessage } from "../features/conversation/src/messages/ConversationMessage";
import { Reasoning } from "@ovule/ui/reasoning";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@ovule/ui/prompt-input";

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: {} } } });
function render(children: ReactNode) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{children}</I18nextProvider>);
}

test("user turns use a bubble, while agent replies and their metadata stay on the thread", () => {
  const user = render(
    <ConversationMessage role="user" author="You">
      Question
    </ConversationMessage>,
  );
  expect(user).toContain('data-slot="bubble"');
  expect(user).toContain('data-align="end"');
  const reply = render(
    <ConversationMessage
      role="assistant"
      status="complete"
      author="Ovule"
      createdAt={0}
      onTelemetry={() => {}}
    >
      <h1>One title</h1>
      <p>Complete answer</p>
    </ConversationMessage>,
  );
  expect(reply).not.toContain('data-slot="bubble"');
  expect(reply).toContain('data-message-role="assistant"');
  expect(reply).toContain('data-slot="message-footer"');
  expect(reply).toContain('dateTime="1970-01-01T00:00:00.000Z"');
  expect(reply.match(/One title/g)).toHaveLength(1);
});

test("empty reasoning has no empty disclosure and failures remain visible outside the answer", () => {
  const waiting = render(<Reasoning running label="Thinking" hasContent={false} />);
  expect(waiting).toContain("Thinking");
  expect(waiting).not.toContain('data-slot="trace-collapsible-trigger"');
  const failed = render(
    <ConversationMessage role="system" author="Ovule" error="Connection failed">
      Partial answer
    </ConversationMessage>,
  );
  expect(failed).toContain('role="alert"');
  expect(failed).toContain("Connection failed");
  expect(failed).toContain("Partial answer");
});

test("prompt input uses form submission and exposes busy state without adding a stop action", () => {
  const html = render(
    <PromptInput>
      <PromptInputBody>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputSubmit busy disabled aria-label="Send" />
      </PromptInputBody>
    </PromptInput>,
  );
  expect(html).toContain("<form");
  expect(html).toContain('type="submit"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-label="Send"');
  expect(html).toContain("disabled");
});
