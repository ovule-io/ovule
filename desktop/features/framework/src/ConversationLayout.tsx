import conversationTokens from "@ovule/conversation/conversation.token";
import frameworkTokens from "@ovule/framework/framework.token";
import sidebarTokens from "@ovule/sidebar/sidebar.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { useTranslation } from "react-i18next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@ovule/ui/cn";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@ovule/ui/drawer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef,
} from "@ovule/ui/layout";

import type { ConversationLayoutViewProps } from "./conversation-layout/view";
import styles from "./ConversationLayout.module.css";
import { useObservableState } from "@ovule/ioc/react";

type ConversationLayoutDependencies = {
  layout: ServiceOf<typeof frameworkTokens.frameworkLayout>;
  Sidebar: ServiceOf<typeof sidebarTokens.sidebarView>;
  Conversation: ServiceOf<typeof conversationTokens.conversationView>;
};

function ConversationLayoutContent({
  dependencies,
  props,
}: {
  dependencies: ConversationLayoutDependencies;
  props: ConversationLayoutViewProps;
}) {
  const { layout, Sidebar, Conversation } = dependencies;
  const { artifactBodyRef, onOpenThreadSwitcher, onNewThread, hidden } = props;

  const { t } = useTranslation();
  const { sidebarOpen, sidebarWidth } = useObservableState(layout, (state) => ({
    sidebarOpen: state.sidebarOpen,
    sidebarWidth: state.sidebarWidth,
  }));
  const chatRef = useRef<HTMLElement>(null);
  const sidebarPanelRef = usePanelRef();
  const resizedSidebarWidth = useRef(sidebarWidth);
  const compactRef = useRef(false);
  const restoreSidebarOpen = useRef(sidebarOpen);
  const compactInteraction = useRef(false);
  const automaticClose = useRef(false);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    const update = () => {
      const next = chat.getBoundingClientRect().width < 567;
      if (next === compactRef.current) return;
      compactRef.current = next;
      if (next) {
        restoreSidebarOpen.current = layout.current().sidebarOpen;
        compactInteraction.current = false;
        if (layout.current().sidebarOpen) {
          automaticClose.current = true;
          layout.setSidebarOpen(false);
        }
      } else if (!compactInteraction.current && restoreSidebarOpen.current) {
        layout.setSidebarOpen(true);
      }
      setCompact(next);
    };
    const observer = new ResizeObserver(update);
    observer.observe(chat);
    update();
    return () => observer.disconnect();
  }, [layout]);

  useEffect(() => {
    if (!compact) return;
    if (automaticClose.current && !sidebarOpen) {
      automaticClose.current = false;
      return;
    }
    if (sidebarOpen) compactInteraction.current = true;
  }, [compact, sidebarOpen]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const frame = requestAnimationFrame(() => {
      try {
        sidebarPanelRef.current?.resize(`${sidebarWidth}px`);
      } catch {
        // The default size covers the first frame while the panel registers.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [sidebarOpen, sidebarWidth, sidebarPanelRef]);

  return (
    <section
      className={cn(
        "chat",
        styles.chat,
        !sidebarOpen && styles.sidebarCollapsed,
        hidden && styles.hidden,
      )}
      ref={chatRef}
      data-chat-root
      aria-hidden={hidden}
    >
      <ResizablePanelGroup
        className={styles.panelGroup}
        orientation="horizontal"
        resizeTargetMinimumSize={{ fine: 16, coarse: 28 }}
        onLayoutChanged={(_layout, meta) => {
          if (meta.isUserInteraction) layout.setSidebarWidth(resizedSidebarWidth.current);
        }}
      >
        {!compact && sidebarOpen && (
          <ResizablePanel
            className={styles.sidebarPanel}
            id="sidebar"
            panelRef={sidebarPanelRef}
            defaultSize={`${sidebarWidth}px`}
            minSize={180}
            maxSize={360}
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              resizedSidebarWidth.current = Math.round(size.inPixels);
            }}
          >
            <Sidebar onOpenThreadSwitcher={onOpenThreadSwitcher} onNewThread={onNewThread} />
          </ResizablePanel>
        )}
        {!compact && sidebarOpen && (
          <ResizableHandle
            className={styles.resizeHandle}
            aria-label={t("workbench.resizeSidebar")}
          >
            <span className={styles.resizeHandleBar} />
          </ResizableHandle>
        )}
        <ResizablePanel
          className={styles.conversationPanel}
          id="conversation"
          minSize={compact ? 0 : 360}
        >
          <Conversation artifactBodyRef={artifactBodyRef} />
        </ResizablePanel>
      </ResizablePanelGroup>
      {compact && (
        <Drawer
          open={sidebarOpen}
          onOpenChange={(open) => {
            compactInteraction.current = true;
            layout.setSidebarOpen(open);
          }}
          direction="left"
          container={chatRef.current}
          noBodyStyles
          disablePreventScroll
        >
          <DrawerContent className={styles.sidebarDrawer}>
            <DrawerTitle className="sr-only">Ovule</DrawerTitle>
            <DrawerDescription className="sr-only">{t("sidebar.recent")}</DrawerDescription>
            <Sidebar onOpenThreadSwitcher={onOpenThreadSwitcher} onNewThread={onNewThread} />
          </DrawerContent>
        </Drawer>
      )}
    </section>
  );
}

export const ConversationLayoutFactory = create((dependsOn) => {
  const layout = dependsOn(frameworkTokens.frameworkLayout);
  const Sidebar = dependsOn(sidebarTokens.sidebarView);
  const Conversation = dependsOn(conversationTokens.conversationView);
  const dependencies = { layout, Sidebar, Conversation };
  return function ConversationLayout(props: ConversationLayoutViewProps) {
    return createElement(ConversationLayoutContent, { dependencies, props });
  };
}, "ConversationLayout");

export const ConversationLayout = (
  ...args: Parameters<ServiceOf<typeof ConversationLayoutFactory>>
) => createElement(useService(ConversationLayoutFactory), ...args);
