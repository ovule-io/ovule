import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ThreadView } from "@ovule/shell-api";
import type { PaneInstance } from "@ovule/panes/tab";
import { Button } from "@ovule/ui/button";
import { Tooltip } from "@ovule/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@ovule/ui/overlays";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenu,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarMenuAction,
} from "@ovule/ui/sidebar";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  GitFork,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@ovule/ui/cn";
import { visibleThreadTabs } from "./sidebar-model";
import styles from "./ChatSidebar.module.css";

export type ThreadTreeModel = {
  selectedThreadId?: string;
  activeWorkbenchId?: string;
  activeArtifacts: Record<string, string | undefined>;
  tabs: PaneInstance[];
  nodeThreads: { thread: ThreadView; parentThreadId: string }[];
  preview?: { threadId?: string; target: string };
  openPreview?(): void;
  selectThread(id: string): void;
  selectTab(ownerId: string, tabId: string): void;
  closeTab(id: string): void;
  moveTab(id: string): void;
  canClose(tab: PaneInstance): boolean;
  renderTabIcon(tab: PaneInstance): ReactNode;
  running: Set<string>;
  archived: readonly string[];
  setArchived(id: string, value: boolean): void;
  fork(thread: ThreadView): Promise<void>;
  addTab(threadId: string): void;
};

export function ThreadSidebarItem({
  thread,
  model,
}: {
  thread: ThreadView;
  model: ThreadTreeModel;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const childrenId = useId();
  const tabs = model.tabs.filter((tab) => tab.threadId === thread.id && tab.placement === "thread");
  const children = model.nodeThreads.filter(
    (child) => child.parentThreadId === thread.id && !model.archived.includes(child.thread.id),
  );
  const selected = model.selectedThreadId === thread.id;
  const visibleTabs = visibleThreadTabs(
    tabs,
    expanded,
    selected ? model.activeArtifacts[thread.id] : undefined,
  );
  const visibleChildren = expanded
    ? children
    : children.filter((child) => child.thread.id === model.selectedThreadId);
  const hasPreview = model.preview?.threadId === thread.id;
  const hasChildren = tabs.length > 0 || children.length > 0 || hasPreview;
  const isArchived = model.archived.includes(thread.id);
  const running =
    model.running.has(thread.id) || children.some((child) => model.running.has(child.thread.id));
  const fork = async () => {
    setPending(true);
    setError(undefined);
    try {
      await model.fork(thread);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <SidebarMenuItem data-thread-group={thread.id}>
      <div
        className={styles.threadHeader}
        data-active={selected && !model.activeArtifacts[thread.id] ? "true" : undefined}
      >
        <SidebarMenuButton
          className={cn("thread-row", styles.threadRow)}
          data-thread-id={thread.id}
          isActive={selected && !model.activeArtifacts[thread.id]}
          onClick={() => model.selectThread(thread.id)}
          title={thread.title}
        >
          <strong className={cn(styles.threadTextLine, styles.threadTitle)}>{thread.title}</strong>
        </SidebarMenuButton>
        {running && (
          <Tooltip side="right" content={t("sidebar.agentRunning")}>
            <Button
              variant="ghost"
              size="sm"
              className={styles.threadIconButton}
              aria-label={t("sidebar.agentRunning")}
              onClick={() => model.selectThread(thread.id)}
            >
              <LoaderCircle className="spin" size={14} />
            </Button>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(styles.threadIconButton, styles.threadMore)}
              aria-label={t("sidebar.threadMenu", { title: thread.title })}
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuItem disabled={pending} onSelect={() => void fork()}>
              <GitFork size={14} />
              {t(pending ? "sidebar.forking" : "sidebar.fork")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => model.addTab(thread.id)}>
              <Plus size={14} />
              {t("explorerTitlebar.addTab")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!tabs.some(model.canClose)}
              onSelect={() => tabs.filter(model.canClose).forEach((tab) => model.closeTab(tab.id))}
            >
              <Trash2 size={14} />
              {t("sidebar.clearTabs")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => model.setArchived(thread.id, !isArchived)}>
              {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {t(isArchived ? "sidebar.restore" : "sidebar.archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {hasChildren && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.threadIconButton}
            aria-label={t(expanded ? "sidebar.collapseTabs" : "sidebar.expandTabs", {
              title: thread.title,
            })}
            aria-expanded={expanded}
            aria-controls={childrenId}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRight className={expanded ? styles.expandedChevron : undefined} size={14} />
          </Button>
        )}
      </div>
      {error && (
        <span className={styles.actionError} role="alert">
          {error}
        </span>
      )}
      <div id={childrenId}>
        {visibleChildren.length > 0 && (
          <SidebarMenuSub>
            {visibleChildren.map(({ thread: child }) => (
              <ThreadSidebarItem key={child.id} thread={child} model={model} />
            ))}
          </SidebarMenuSub>
        )}
        {hasPreview && expanded && (
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton onClick={model.openPreview} title={model.preview?.target}>
                <SquareArrowOutUpRight size={12} />
                <span>{model.preview?.target}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        )}
        <ArtifactTabs tabs={visibleTabs} ownerId={thread.id} model={model} />
      </div>
    </SidebarMenuItem>
  );
}

export function ArtifactTabs({
  tabs,
  ownerId,
  model,
  nested = true,
}: {
  tabs: PaneInstance[];
  ownerId: string;
  model: ThreadTreeModel;
  nested?: boolean;
}) {
  const { t } = useTranslation();
  if (!tabs.length) return null;
  return (
    <TabList nested={nested}>
      {tabs.map((tab) => (
        <SidebarMenuSubItem
          key={tab.id}
          className={cn("artifact-row", styles.artifactRow)}
          data-thread-id={tab.threadId}
          data-draft-id={tab.draftId}
          data-tab-id={tab.id}
        >
          <SidebarMenuSubButton
            className={cn("artifact-select", styles.artifactSelect)}
            isActive={
              tab.placement !== "thread"
                ? model.activeWorkbenchId === tab.id
                : (!tab.threadId
                    ? !model.selectedThreadId
                    : model.selectedThreadId === tab.threadId) &&
                  model.activeArtifacts[tab.threadId || tab.draftId || ownerId] === tab.id
            }
            onClick={() => model.selectTab(tab.threadId || tab.draftId || ownerId, tab.id)}
            title={tab.url ?? tab.target ?? tab.title}
          >
            <span className={styles.artifactIcon}>{model.renderTabIcon(tab)}</span>
            <span className={styles.artifactTitle}>{tab.title}</span>
          </SidebarMenuSubButton>
          <Tooltip
            className={styles.artifactActionTooltip}
            content={t("explorerTitlebar.openInWorkbench")}
            side="right"
            style={{ right: 30 }}
          >
            <SidebarMenuAction
              className={styles.artifactAction}
              aria-label={t("explorerTitlebar.openInWorkbench")}
              onClick={() => model.moveTab(tab.id)}
            >
              <SquareArrowOutUpRight size={12} />
            </SidebarMenuAction>
          </Tooltip>
          <Tooltip
            className={styles.artifactActionTooltip}
            content={t("browser.closeTab", { title: tab.title })}
            side="right"
            style={{ right: 4 }}
          >
            <SidebarMenuAction
              className={styles.artifactAction}
              disabled={!model.canClose(tab)}
              aria-label={t("browser.closeTab", { title: tab.title })}
              onClick={() => model.closeTab(tab.id)}
            >
              <X size={12} />
            </SidebarMenuAction>
          </Tooltip>
        </SidebarMenuSubItem>
      ))}
    </TabList>
  );
}

function TabList({ nested, children }: { nested: boolean; children: ReactNode }) {
  return nested ? (
    <SidebarMenuSub>{children}</SidebarMenuSub>
  ) : (
    <SidebarMenu>{children}</SidebarMenu>
  );
}
