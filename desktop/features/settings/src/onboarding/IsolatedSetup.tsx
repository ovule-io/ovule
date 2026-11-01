import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useService } from "@ovule/ioc/react";
import shellTokens from "@ovule/shell/shell.token";
import type { ExtensionOnboardingView } from "@ovule/shell-api";
import type { IsolatedView } from "@ovule/shell/isolated";

export function IsolatedSetup(props: {
  setup: ExtensionOnboardingView;
  progress: string;
  busy?: boolean;
  onCancel?(): void;
  onAction(
    actionId: string,
    values: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<boolean | undefined>;
  onOpen(url: string): void;
}) {
  const { i18n } = useTranslation();
  const shell = useService(shellTokens.shell);
  const target = useRef<HTMLDivElement>(null);
  const view = useRef<IsolatedView | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  useEffect(() => {
    if (!target.current) return;
    if (!props.setup.tag) {
      setError("This extension must provide an isolated onboarding UI");
      return;
    }
    let active = true;
    let mounted: IsolatedView | undefined;
    void shell
      .mountIsolated(
        target.current,
        props.setup.extensionId,
        props.setup.tag,
        {
          setup: props.setup,
          progress: props.progress,
          lang: i18n.language,
          busy: props.busy ?? false,
          canCancel: Boolean(props.onCancel),
        },
        async ({ method, params, signal }) => {
          if (signal.aborted) throw new Error("Setup closed");
          if (method === "onboarding.cancel" && latest.current.onCancel) {
            latest.current.onCancel();
            return null;
          }
          const value = params as { actionId?: unknown; values?: unknown; url?: unknown } | null;
          if (
            method === "onboarding.open" &&
            typeof value?.url === "string" &&
            latest.current.setup.allowedLinks.includes(value.url)
          ) {
            latest.current.onOpen(value.url);
            return null;
          }
          if (
            method !== "onboarding.action" ||
            typeof value?.actionId !== "string" ||
            !latest.current.setup.actions.some((a) => a.id === value.actionId) ||
            !value.values ||
            typeof value.values !== "object" ||
            Array.isArray(value.values)
          )
            throw new Error("Unsupported onboarding request");
          const values: Record<string, string> = {};
          for (const id of latest.current.setup.inputFields) {
            const v = (value.values as Record<string, unknown>)[id];
            if (v !== undefined && (typeof v !== "string" || v.length > 16384))
              throw new Error("Invalid setup field");
            values[id] = typeof v === "string" ? v : "";
          }
          if (!(await latest.current.onAction(value.actionId, values, signal)))
            throw new Error("Setup action failed. Check the setup status.");
          return null;
        },
      )
      .then(async (result) => {
        mounted = result;
        if (!active) {
          await result.dispose();
          return;
        }
        view.current = result;
        await result.update({
          setup: latest.current.setup,
          progress: latest.current.progress,
          lang: i18n.language,
          busy: latest.current.busy ?? false,
          canCancel: Boolean(latest.current.onCancel),
        });
      })
      .catch((e) => {
        if (active) setError(String(e.message ?? e));
      });
    return () => {
      active = false;
      view.current = undefined;
      void mounted?.dispose();
    };
  }, [props.setup.extensionId, props.setup.tag, shell]);
  useEffect(() => {
    void view.current
      ?.update({
        setup: props.setup,
        progress: props.progress,
        lang: i18n.language,
        busy: props.busy ?? false,
        canCancel: Boolean(props.onCancel),
      })
      .catch((e) => setError(String(e)));
  }, [props.setup, props.progress, props.busy, props.onCancel, i18n.language]);
  return (
    <div data-isolated-onboarding={props.setup.extensionId}>
      <div ref={target} />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
