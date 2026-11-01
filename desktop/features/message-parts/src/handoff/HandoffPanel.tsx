import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Button } from "@ovule/ui/button";
import { useService } from "@ovule/ioc/react";
import { Check, Copy, ExternalLink, Hand, Monitor, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { PaneContext } from "@ovule/panes/pane";
import { decodeHumanHandoff, handoffLaunchUrl } from "./protocol-codec";

type HandoffPanelDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function HandoffPanelContent({
  dependencies,
  props,
}: {
  dependencies: HandoffPanelDependencies;
  props: PaneContext;
}) {
  const { copyText } = useService(shellTokens.shell);

  const { workspace } = dependencies;
  const { target, thread, invoke, busy } = props;

  const { t } = useTranslation();
  const request = decodeHumanHandoff(target);
  const [completed, setCompleted] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!request) {
    return (
      <main
        className="grid h-full place-items-center bg-(--background) p-6 text-(--muted-foreground)"
        role="alert"
      >
        {t("handoff.invalid")}
      </main>
    );
  }
  const launchUrl = handoffLaunchUrl(request);
  const complete = async () => {
    if (!thread || completed) return;
    const changed = await invoke((api) =>
      api.sendMessage(
        thread.id,
        `Human handoff completed (${request.id}). Continue from the verified user-controlled step.`,
      ),
    );
    if (changed) setCompleted(true);
  };

  return (
    <main
      className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-(--background)"
      data-human-handoff={request.protocol}
    >
      <div className="min-h-0 overflow-auto p-5">
        <section className="mx-auto grid max-w-[760px] gap-4">
          <header className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-(--line) bg-(--surface-2)">
              <Hand size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-(length:--font-size-caption) text-(--muted-foreground)">
                {t("handoff.eyebrow")}
              </p>
              <h2 className="mt-0.5 mb-0 text-(length:--font-size-title) font-medium text-(--foreground)">
                {request.title}
              </h2>
            </div>
            <span className="rounded-full border border-(--line) px-2 py-1 text-(length:--font-size-caption) text-(--muted-foreground)">
              {request.protocol.toUpperCase()}
            </span>
          </header>

          <p className="m-0 text-(length:--font-size-ui) leading-6 text-(--muted-foreground)">
            {request.instructions}
          </p>

          {request.appshotUrl ? (
            <figure className="m-0 overflow-hidden rounded-xl border border-(--line) bg-(--surface-2)">
              <img
                className="block max-h-[520px] w-full object-contain"
                src={request.appshotUrl}
                alt={request.appshotAlt ?? request.title}
              />
              <figcaption className="flex items-center gap-2 border-t border-(--line) px-3 py-2 text-(length:--font-size-caption) text-(--muted-foreground)">
                <Monitor size={13} /> {t("handoff.appshot")}
              </figcaption>
            </figure>
          ) : (
            <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-(--line) bg-(--surface-2) text-(--muted-foreground)">
              <span className="grid justify-items-center gap-2 text-(length:--font-size-ui)">
                <Monitor size={22} /> {t("handoff.noAppshot")}
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-(--line) bg-(--surface) p-3 text-(length:--font-size-caption) text-(--muted-foreground)">
            <ShieldCheck className="mt-0.5 shrink-0" size={15} />
            <span>{t("handoff.security")}</span>
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-(--line) bg-(--surface) px-4 py-3">
        <div className="min-w-0 text-(length:--font-size-caption) text-(--muted-foreground)">
          {request.target ?? t("handoff.noEndpoint")}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {request.target && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void copyText(request.target!).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_500);
                });
              }}
            >
              <Copy size={13} /> {copied ? t("handoff.copied") : t("handoff.copyEndpoint")}
            </Button>
          )}
          {launchUrl && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => workspace.requestBrowserUse(launchUrl)}
            >
              <ExternalLink size={13} /> {t("handoff.takeControl")}
            </Button>
          )}
          <Button size="sm" disabled={!thread || busy || completed} onClick={() => void complete()}>
            <Check size={14} /> {completed ? t("handoff.completed") : t("handoff.continue")}
          </Button>
        </div>
      </footer>
    </main>
  );
}

export const HandoffPanelFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function HandoffPanel(props: PaneContext) {
    return createElement(HandoffPanelContent, { dependencies, props });
  };
}, "HandoffPanel");

export const HandoffPanel = (...args: Parameters<ServiceOf<typeof HandoffPanelFactory>>) =>
  createElement(useService(HandoffPanelFactory), ...args);
