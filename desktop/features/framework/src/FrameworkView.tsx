import frameworkTokens from "./framework.token";
import panesTokens from "@ovule/panes/panes.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import workbenchTokens from "@ovule/workbench/workbench.token";
import { projectServices } from "@ovule/ioc/observable";

import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { Suspense, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@ovule/ui/cn";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@ovule/ui/layout";

import type { FrameworkViewProps } from "./view";
import { useFrameworkLayoutFactory } from "./useFrameworkLayout";
import styles from "./Framework.module.css";
import { CONTENT_MIN_WIDTH, WORKBENCH_MIN_WIDTH } from "./workbench-window";
import { useObservableState } from "@ovule/ioc/react";

type FrameworkDependencies = {
  useFrameworkLayout: ServiceOf<typeof useFrameworkLayoutFactory>;
  ConversationLayout: ServiceOf<typeof frameworkTokens.conversationLayoutView>;
  Content: ServiceOf<typeof frameworkTokens.contentView>;
  Workbench: ServiceOf<typeof workbenchTokens.workbenchView>;
  PaneSurface: ServiceOf<typeof panesTokens.paneSurfaceView>;
  stateView: ServiceOf<typeof StateProjectionFactory>;
  selectionService: ServiceOf<typeof conversationTokens.selection>;
  explorerService: ServiceOf<typeof panesTokens.panes>;
  frameworkLayoutService: ServiceOf<typeof frameworkTokens.frameworkLayout>;
  mainOverlayService: ServiceOf<typeof frameworkTokens.mainOverlay>;
};

function FrameworkContent({
  dependencies,
  props,
}: {
  dependencies: FrameworkDependencies;
  props: FrameworkViewProps;
}) {
  const {
    useFrameworkLayout,
    ConversationLayout,
    Content,
    Workbench,
    PaneSurface,
    stateView,
    selectionService,
    explorerService,
    frameworkLayoutService,
    mainOverlayService,
  } = dependencies;
  const { onOpenThreadSwitcher, onNewThread, setupOpen = false, setup } = props;

  const { t } = useTranslation();
  const snapshot = useObservableState(stateView, (state) => state.snapshot);
  const selectedThreadId = useObservableState(selectionService, (state) => state.selectedThreadId);
  const thread =
    selectedThreadId === ""
      ? undefined
      : (snapshot?.threads.find((item) => item.id === selectedThreadId) ?? snapshot?.threads[0]);
  const allTabs = useObservableState(explorerService, (state) => state.instances);
  const activeArtifacts = useObservableState(
    explorerService,
    (state) => state.activeThreadArtifacts,
  );
  const draftId = useObservableState(explorerService, (state) => state.draftConversationId);
  const activeId = activeArtifacts[thread?.id ?? draftId];
  const active = allTabs.find((tab) => tab.id === activeId);
  const expanded = useObservableState(frameworkLayoutService, (state) => state.workbenchExpanded);
  const workbenchActiveId = useObservableState(
    explorerService,
    (state) => state.activeWorkbenchPaneId,
  );
  const instances = allTabs.filter((tab) => tab.placement !== "thread");
  const workbenchActive = instances.find((tab) => tab.id === workbenchActiveId) ?? instances.at(-1);
  const sidebarOpen = useObservableState(frameworkLayoutService, (state) => state.sidebarOpen);
  const contentSurfaceOpen = useObservableState(
    mainOverlayService,
    (state) => state.settingsOpen || state.remoteWorkspacesOpen,
  );
  const layout = useFrameworkLayout();
  const shellRef = useRef<HTMLDivElement>(null);
  const panelGroupRef = useRef<HTMLDivElement>(null);
  const artifactRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = usePanelRef();
  const workbenchPanelRef = usePanelRef();
  const normalWidths = useRef({ chat: 568, workbench: layout.workbenchWidth });
  const wasExpanded = useRef(false);
  const restoreWidths = useRef(normalWidths.current);
  // Capture before the panel group commits its collapsed constraints and emits
  // intermediate layouts during the same commit.
  const widthsBeforeExpansion =
    expanded && !wasExpanded.current ? { ...normalWidths.current } : undefined;
  const [regions, setRegions] = useState<{
    chat?: CSSProperties;
    workbench?: CSSProperties;
  }>({});

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => {
      if (layout.workbenchOpen && !expanded && !shell.dataset.workbenchResizing) {
        const chat = shell
          .querySelector<HTMLElement>("[data-workbench-chat]")
          ?.getBoundingClientRect().width;
        const workbench = shell
          .querySelector<HTMLElement>("[data-workbench-root]")
          ?.getBoundingClientRect().width;
        if (chat && workbench) normalWidths.current = { chat, workbench };
      }
      const base = shell.getBoundingClientRect();
      const region = (element: HTMLDivElement | null): CSSProperties | undefined => {
        if (!element || !element.getBoundingClientRect().width) return undefined;
        const bounds = element.getBoundingClientRect();
        return {
          position: "absolute",
          left: bounds.left - base.left,
          top: bounds.top - base.top,
          width: bounds.width,
          height: bounds.height,
        };
      };
      setRegions((current) => ({
        chat: region(artifactRef.current) ?? current.chat,
        workbench: region(workbenchRef.current) ?? current.workbench,
      }));
    };
    const observer = new ResizeObserver(update);
    for (const element of [shell, artifactRef.current, workbenchRef.current])
      if (element) observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [active?.id, layout.workbenchOpen, expanded, sidebarOpen, layout.workbenchWidth]);

  const columns = {
    "--workbench-width": `${layout.workbenchWidth}px`,
  } as CSSProperties;
  useLayoutEffect(() => {
    if (!layout.workbenchOpen || !workbenchPanelRef.current) {
      wasExpanded.current = false;
      return;
    }
    try {
      if (expanded) {
        if (!wasExpanded.current) {
          restoreWidths.current = widthsBeforeExpansion ?? restoreWidths.current;
          frameworkLayoutService.setWorkbenchWidth(restoreWidths.current.workbench);
        }
        workbenchPanelRef.current?.resize("100%");
      } else if (wasExpanded.current) {
        // Panel constraint changes re-register with the group in a subsequent
        // commit. Restore after that registration, using the saved pixel width.
        const width = restoreWidths.current.chat;
        const frame = requestAnimationFrame(() => chatPanelRef.current?.resize(`${width}px`));
        wasExpanded.current = false;
        return () => cancelAnimationFrame(frame);
      } else {
        const lockedWidth = shellRef.current?.style.getPropertyValue("--workbench-chat-width");
        if (lockedWidth) {
          // A reopened group may still carry percentages from before a native
          // window resize. Commit the current left width after registration,
          // while the transition's CSS lock still protects the visible layout.
          const frame = requestAnimationFrame(() => chatPanelRef.current?.resize(lockedWidth));
          return () => cancelAnimationFrame(frame);
        }
        workbenchPanelRef.current?.resize(`${layout.workbenchWidth}px`);
      }
      wasExpanded.current = expanded;
    } catch {
      // The panel's default size is already correct while a dynamic layout registers.
    }
  }, [chatPanelRef, expanded, layout.workbenchOpen, layout.workbenchWidth, workbenchPanelRef]);
  return (
    <div
      className={cn(
        "framework",
        styles.framework,
        "grid min-h-0 min-w-0",
        expanded && layout.workbenchOpen && [styles.workbenchExpanded, "workbench-expanded"],
        layout.workbenchOpen && [styles.workbenchVisible, "workbench-visible"],
        !sidebarOpen && [styles.sidebarCollapsed, "sidebar-collapsed"],
      )}
      style={columns}
      ref={shellRef}
    >
      <ResizablePanelGroup
        className={styles.panelGroup}
        elementRef={panelGroupRef}
        orientation="horizontal"
        resizeTargetMinimumSize={{ fine: 16, coarse: 28 }}
        onLayoutChanged={(sizes, meta) => {
          if (!expanded && layout.workbenchOpen && panelGroupRef.current && sizes.workbench) {
            const available = panelGroupRef.current.clientWidth - 4;
            const chat = (sizes.chat / 100) * available;
            const workbench = (sizes.workbench / 100) * available;
            if (chat >= CONTENT_MIN_WIDTH - 1 && workbench >= WORKBENCH_MIN_WIDTH - 1)
              normalWidths.current = { chat, workbench };
          }
          if (meta.isUserInteraction && !expanded && panelGroupRef.current && sizes.workbench) {
            // This callback precedes the DOM update; getSize().inPixels still
            // measures the previous frame. Persist the committed percentage.
            const available = panelGroupRef.current.clientWidth - 4;
            layout.setWorkbenchWidth((sizes.workbench / 100) * available);
          }
        }}
      >
        <ResizablePanel
          className={styles.paneFrame}
          id="chat"
          data-workbench-chat
          panelRef={chatPanelRef}
          minSize={expanded && layout.workbenchOpen ? 0 : CONTENT_MIN_WIDTH}
          maxSize={expanded && layout.workbenchOpen ? 0 : undefined}
          collapsible={expanded}
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
        >
          <ConversationLayout
            artifactBodyRef={artifactRef}
            onOpenThreadSwitcher={onOpenThreadSwitcher}
            onNewThread={onNewThread}
            hidden={setupOpen || contentSurfaceOpen}
          />
          {setupOpen && <section className={styles.setup}>{setup}</section>}
          {!setupOpen && contentSurfaceOpen && (
            <section className={styles.setup} data-framework-left-surface>
              <Suspense fallback={null}>
                <Content />
              </Suspense>
            </section>
          )}
        </ResizablePanel>
        {layout.workbenchOpen && !expanded && (
          <ResizableHandle className={styles.panelResize} aria-label={t("workbench.resizePanel")}>
            <span className={styles.panelResizeBar} />
          </ResizableHandle>
        )}
        {layout.workbenchOpen && (
          <ResizablePanel
            className={styles.paneFrame}
            id="workbench"
            data-workbench-panel
            panelRef={workbenchPanelRef}
            defaultSize={`${layout.workbenchWidth}px`}
            minSize={WORKBENCH_MIN_WIDTH}
            maxSize="100%"
            groupResizeBehavior="preserve-relative-size"
          >
            <Suspense fallback={null}>
              <Workbench threadId={thread?.id} bodyRef={workbenchRef} />
            </Suspense>
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
      <div className={styles.toolLayer}>
        {allTabs.map((tab) => {
          const inThread = tab.placement === "thread";
          const visible = inThread
            ? !setupOpen && !contentSurfaceOpen && !expanded && tab.id === active?.id
            : layout.workbenchOpen && tab.id === workbenchActive?.id;
          return (
            <Suspense key={tab.id} fallback={null}>
              <PaneSurface
                tab={tab}
                active={visible}
                style={inThread ? regions.chat : regions.workbench}
              />
            </Suspense>
          );
        })}
      </div>
    </div>
  );
}

export const FrameworkFactory = create((dependsOn) => {
  const useFrameworkLayout = dependsOn(useFrameworkLayoutFactory);
  const ConversationLayout = dependsOn(frameworkTokens.conversationLayoutView);
  const Content = dependsOn(frameworkTokens.contentView);
  const Workbench = dependsOn(workbenchTokens.workbenchView);
  const PaneSurface = dependsOn(panesTokens.paneSurfaceView);
  const stateView = dependsOn(StateProjectionFactory);
  const selectionService = dependsOn(conversationTokens.selection);
  const explorerService = dependsOn(panesTokens.panes);
  const frameworkLayoutService = dependsOn(frameworkTokens.frameworkLayout);
  const mainOverlayService = dependsOn(frameworkTokens.mainOverlay);
  const dependencies = {
    useFrameworkLayout,
    ConversationLayout,
    Content,
    Workbench,
    PaneSurface,
    stateView,
    selectionService,
    explorerService,
    frameworkLayoutService,
    mainOverlayService,
  };
  return function Framework(props: FrameworkViewProps) {
    return createElement(FrameworkContent, { dependencies, props });
  };
}, "Framework");

export const Framework = (...args: Parameters<ServiceOf<typeof FrameworkFactory>>) =>
  createElement(useService(FrameworkFactory), ...args);

const StateProjectionFactory = create((dependsOn) => {
  const conversation = dependsOn(conversationTokens.conversationState);
  const reader = projectServices([conversation] as const, (conversationState) => ({
    snapshot: conversationState.snapshot
      ? {
          ...conversationState.snapshot,
          revision: [conversationState.snapshot.revision].reduce(
            (latest, value) => (value > latest ? value : latest),
            0n,
          ),
        }
      : undefined,
    pending: conversationState.pending,
    busy: conversationState.busy,
    error: conversationState.error,
  }));
  return reader;
}, "FrameworkViewStateProjection");
