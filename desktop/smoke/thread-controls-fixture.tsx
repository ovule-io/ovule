import "@ovule/ui/styles.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import en from "../features/i18n/src/locales/en.json";
import { ConversationMessage } from "../features/conversation/src/messages/ConversationMessage";
import { GenerationControl } from "../features/conversation/src/composer/GenerationControl";
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
const host = window as unknown as {
  actions: unknown[];
  rejectRestart: boolean;
  finishStop?: () => void;
};
host.actions = [];
function Fixture() {
  const [prompt, setPrompt] = useState("Original prompt");
  const [reply, setReply] = useState("Old reply");
  const [running, setRunning] = useState(true);
  const [stopping, setStopping] = useState(false);
  return (
    <I18nextProvider i18n={i18n}>
      <ConversationMessage
        role="user"
        author="You"
        prompt={prompt}
        onFork={async () => {
          host.actions.push({ kind: "fork" });
          return true;
        }}
        onRestart={async (text) => {
          host.actions.push({ kind: "restart", text });
          if (host.rejectRestart) return false;
          setPrompt(text);
          setReply("New reply");
          return true;
        }}
      >
        <p id="original">{prompt}</p>
      </ConversationMessage>
      <p id="reply">{reply}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          host.actions.push({ kind: "send" });
        }}
      >
        <GenerationControl
          running={running}
          stopping={stopping}
          sending={false}
          canSend
          translate={i18n.t.bind(i18n)}
          onStop={async () => {
            setStopping(true);
            host.actions.push({ kind: "stop" });
            await new Promise<void>((resolve) => {
              host.finishStop = resolve;
            });
            setRunning(false);
            setStopping(false);
          }}
        />
      </form>
    </I18nextProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
