import "@ovule/ui/styles.css";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { createAgentApprovals } from "../features/shell/src/agent-approvals";
import { createInstance } from "i18next";
import en from "../features/i18n/src/locales/en.json";
const approvals = createAgentApprovals();
const events = new EventTarget();
Object.assign(window, {
  tuffite: events,
  answers: [],
  hostPending: [] as Array<Record<string, unknown>>,
  request: (request: { kind: string; requestId: string; attemptId?: string }) => {
    const host = window as unknown as { hostPending: Array<Record<string, unknown>> };
    host.hostPending = host.hostPending.filter((item) => item.requestId !== request.requestId);
    if (request.kind === "request") host.hostPending.push(request);
    return events.dispatchEvent(
      new CustomEvent("channel", {
        detail: {
          channel: "ovule:agent-approval",
          data: new TextEncoder().encode(JSON.stringify(request)),
        },
      }),
    );
  },
});
Object.assign(window, { dispose: approvals.install() });
const root = createRoot(document.getElementById("approvals")!);
const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: en } } });
const translate = i18n.t.bind(i18n);
const show = (attemptId: string, active = false) =>
  root.render(createElement(approvals.View, { attemptId, translate, active }));
Object.assign(window, { showAttempt: show });
show("test-attempt");

createRoot(document.getElementById("approval-mode")!).render(
  createElement(approvals.ModePicker, { translate }),
);
