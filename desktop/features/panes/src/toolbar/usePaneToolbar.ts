import terminalTokens from "@ovule/terminal/terminal.token";
import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { projectServices } from "@ovule/ioc/observable";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { useEffect, useRef, useState } from "react";

import { useObservableState } from "@ovule/ioc/react";
import type { PaneInstance } from "@ovule/panes/tab";

type UsePaneToolbarDependencies = {
  explorer: ServiceOf<typeof panesTokens.panes>;
  layout: ServiceOf<typeof frameworkTokens.frameworkLayout>;
  stateView: ServiceOf<typeof StateProjectionFactory>;
};

function usePaneToolbarImpl(dependencies: UsePaneToolbarDependencies, active?: PaneInstance) {
  const { explorer, layout, stateView } = dependencies;

  const expanded = useObservableState(layout, (s) => s.workbenchExpanded);
  const sidebarOpen = useObservableState(layout, (s) => s.sidebarOpen);
  const terminalRuns = useObservableState(stateView, (s) => s.snapshot?.terminalRuns);
  const submitting = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    setEditing(false);
    setListOpen(false);
    setAddOpen(false);
    setError(undefined);
    setAddress(active?.url ?? active?.target ?? "");
  }, [active?.id, active?.target, active?.url]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      setListOpen(false);
      setAddOpen(false);
      setEditing(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const paneCommand = (action: string) => {
    if (active)
      window.dispatchEvent(
        new CustomEvent("ovule:pane-command", {
          detail: { tabId: active.id, action },
        }),
      );
  };

  const submit = async (value: string) => {
    if (!active || !value.trim() || submitting.current) return;
    if (active.kind === "terminal") {
      paneCommand(`search:${value.trim()}`);
      setEditing(false);
      return;
    }
    submitting.current = true;
    try {
      explorer.updateTab(active.id, {
        target: value.trim(),
        url: undefined,
        title:
          active.kind === "browser"
            ? value.trim()
            : value.trim().split(/[\\/]/).at(-1) || active.title,
        requestVersion: active.requestVersion + 1,
      });
      setEditing(false);
      setError(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      submitting.current = false;
    }
  };

  const canClose = (tab: PaneInstance) =>
    !terminalRuns?.some(
      (run) => run.ownerId === tab.id && ["queued", "running", "cancelling"].includes(run.status),
    );

  return {
    explorer,
    layout,
    expanded,
    sidebarOpen,
    root,
    listOpen,
    setListOpen,
    addOpen,
    setAddOpen,
    editing,
    setEditing,
    address,
    setAddress,
    error,
    submit,
    paneCommand,
    canClose,
  };
}

export const usePaneToolbarFactory = create((dependsOn) => {
  const explorer = dependsOn(panesTokens.panes);
  const layout = dependsOn(frameworkTokens.frameworkLayout);
  const stateView = dependsOn(StateProjectionFactory);
  return usePaneToolbarImpl.bind(undefined, {
    explorer,
    layout,
    stateView,
  });
}, "usePaneToolbar");

export const usePaneToolbar = (...args: Parameters<ServiceOf<typeof usePaneToolbarFactory>>) =>
  useService(usePaneToolbarFactory)(...args);

const StateProjectionFactory = create((dependsOn) => {
  const terminal = dependsOn(terminalTokens.terminalState);
  const reader = projectServices([terminal] as const, (terminalState) => ({
    snapshot: terminalState.snapshot
      ? {
          ...terminalState.snapshot,
          revision: [terminalState.snapshot.revision].reduce(
            (latest, value) => (value > latest ? value : latest),
            0n,
          ),
        }
      : undefined,
    pending: terminalState.pending,
    busy: terminalState.busy,
    error: terminalState.error,
  }));
  return reader;
}, "usePaneToolbarStateProjection");
