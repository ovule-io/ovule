import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "@ovule/framework/framework.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import type { RefObject } from "react";

import { useObservableState } from "@ovule/ioc/react";
export const WorkbenchFactory = create((dependsOn) => {
  const WorkbenchToolbar = dependsOn(panesTokens.workbenchToolbarView);
  const explorerService = dependsOn(panesTokens.panes);
  const frameworkLayoutService = dependsOn(frameworkTokens.frameworkLayout);
  return function Workbench({
    threadId,
    bodyRef,
  }: {
    threadId?: string;
    bodyRef: RefObject<HTMLDivElement | null>;
  }) {
    const { i18n } = useTranslation();
    const tabs = useObservableState(explorerService, (s) => s.instances).filter(
      (tab) => tab.placement !== "thread",
    );
    const activeId = useObservableState(explorerService, (s) => s.activeWorkbenchPaneId);
    const open = useObservableState(frameworkLayoutService, (s) => s.workbenchOpen);
    const active = tabs.find((tab) => tab.id === activeId) ?? tabs.at(-1);
    return (
      <aside
        className="workbench col-start-2 grid min-h-0 min-w-0 grid-rows-[56px_minmax(0,1fr)] overflow-hidden rounded-(--app-pane-radius) bg-(--background)"
        data-workbench-root
        hidden={!open}
        aria-label={i18n.t("workbench.workbench")}
      >
        <WorkbenchToolbar tabs={tabs} active={active} threadId={threadId} />
        <div className="min-h-0 min-w-0 overflow-hidden" ref={bodyRef} />
      </aside>
    );
  };
}, "Workbench");

export const Workbench = (...args: Parameters<ServiceOf<typeof WorkbenchFactory>>) =>
  createElement(useService(WorkbenchFactory), ...args);
