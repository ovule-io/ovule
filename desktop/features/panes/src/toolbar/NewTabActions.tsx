import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@ovule/ui/select";
import { openLocalFile } from "./open-local-file";
import conversationTokens from "@ovule/conversation/conversation.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import hostsTokens from "@ovule/hosts/hosts.token";
import shellTokens from "@ovule/shell/shell.token";
import remotingTokens from "@ovule/remoting/remoting.token";
import { projectServices } from "@ovule/ioc/observable";
import { create } from "@ovule/ioc";
import { useService, useObservableState } from "@ovule/ioc/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ovule/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ovule/ui/dialog";
import { Folder, House, MonitorUp } from "lucide-react";
import type { RemoteEndpointView } from "@ovule/shell-api";
import type { ToolbarModel } from "./useToolbarModel";
import styles from "./PaneToolbar.module.css";

export function NewTabActions({ model }: { model: ToolbarModel }) {
  const { active, tabs, threadId, draftId, placement, explorer: workbenchService } = model;
  const { encodeLinkRemoteControlSession, encodeSpiceSession } = useService(
    remotingTokens.sessionLinks,
  );
  const workspace = useService(workspaceTokens.workspace);
  const [shellProfiles, setShellProfiles] = useState<{ id: string; name: string }[]>([]);
  const [shellProfile, setShellProfile] = useState("");
  const [profileError, setProfileError] = useState("");
  const { dialog } = useService(shellTokens.shell);
  const stateView = useService(StateProjectionFactory);
  const snapshot = useObservableState(stateView, (state) => state.snapshot);
  const { t } = useTranslation();
  const sourceTab = useRef<string | undefined>(undefined);
  const [terminalDialogOpen, setTerminalDialogOpen] = useState(false);
  const [remoteHostDialogOpen, setRemoteHostDialogOpen] = useState(false);
  const thread = snapshot?.threads.find((item) => item.id === threadId);
  const workspaceBindings = (thread?.workspaceBindingIds ?? [])
    .map((id) => snapshot?.bindings.find((binding) => binding.id === id))
    .filter((binding) => binding !== undefined);
  useEffect(() => {
    if (!terminalDialogOpen) return;
    let active = true;
    setProfileError("");
    void workspace
      .api()
      .then((api) => api.shellProfiles())
      .then((json) => {
        if (!active) return;
        const profiles = JSON.parse(json) as { id: string; name: string }[];
        setShellProfiles(profiles);
        setShellProfile((previous) =>
          profiles.some((p) => p.id === previous) ? previous : (profiles[0]?.id ?? ""),
        );
      })
      .catch((error) => {
        if (active) setProfileError(String(error));
      });
    return () => {
      active = false;
    };
  }, [terminalDialogOpen, workspace]);
  const openTerminal = (location: string) => {
    const workspaceBindingId = location.startsWith("binding:")
      ? location.slice("binding:".length)
      : undefined;
    workbenchService.openTab("terminal", {
      threadId,
      draftId,
      newInstance: true,
      placement,
      workspaceBindingId,
      useThreadWorkspace: location === "thread",
      replaceBlankId: sourceTab.current,
      shellProfileId: workspaceBindingId ? undefined : shellProfile || undefined,
    });
    setTerminalDialogOpen(false);
  };
  const openRemoteHost = (endpoint: RemoteEndpointView) => {
    const target = isLinkEndpoint(endpoint)
      ? encodeLinkRemoteControlSession({
          endpointId: endpoint.id,
          displayName: endpoint.displayName,
        })
      : encodeSpiceSession({
          endpointId: endpoint.id,
          displayName: endpoint.displayName,
          websocketUrl: endpoint.spiceWebsocketUrl ?? "",
        });
    const existing = tabs.find((tab) => tab.kind === "spice" && tab.target === target);
    if (existing && !sourceTab.current) workbenchService.selectTab(existing.id);
    else
      workbenchService.openTab("spice", {
        target,
        autoLoad: true,
        replaceBlankId: sourceTab.current,
        threadId,
        draftId,
        newInstance: true,
        placement,
      });
    setRemoteHostDialogOpen(false);
  };
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          tabId: string;
          kind: string;
          resolve?(value: unknown): void;
          reject?(error: unknown): void;
        }>
      ).detail;
      if (detail?.tabId !== active?.id) return;
      sourceTab.current = detail.tabId;
      const handlers: Record<string, () => Promise<{ opened: boolean }> | { opened: boolean }> = {
        terminal: () => {
          setTerminalDialogOpen(true);
          return { opened: true };
        },
        spice: () => {
          setRemoteHostDialogOpen(true);
          return { opened: true };
        },
        workflow: () => {
          workbenchService.openTab("workflow", {
            threadId,
            draftId,
            placement,
            newInstance: true,
            replaceBlankId: detail.tabId,
          });
          return { opened: true };
        },
        files: () =>
          openLocalFile({
            dialog,
            panes: workbenchService,
            title: t("harness.localFiles"),
            options: { threadId, draftId, placement, replaceBlankId: detail.tabId },
          }),
      };
      void Promise.resolve()
        .then(() => handlers[detail.kind]?.() ?? { opened: false })
        .then((value) => detail.resolve?.(value))
        .catch((error) => {
          if (detail.reject) detail.reject(error);
          else console.error(error);
        });
    };
    window.addEventListener("ovule:new-tab-action", open);
    return () => window.removeEventListener("ovule:new-tab-action", open);
  }, [active?.id, dialog, workbenchService, threadId, draftId, placement, t]);

  return (
    <>
      <Dialog open={terminalDialogOpen} onOpenChange={setTerminalDialogOpen}>
        <DialogContent className={styles.terminalDialog}>
          <DialogHeader>
            <DialogTitle>{t("terminal.locationTitle")}</DialogTitle>
            <DialogDescription>{t("terminal.locationDescription")}</DialogDescription>
          </DialogHeader>
          <div className={styles.terminalProfile}>
            <label id="terminal-profile-label">{t("terminal.shellProfile")}</label>
            <Select
              value={shellProfile}
              onValueChange={setShellProfile}
              disabled={!shellProfiles.length}
            >
              <SelectTrigger aria-labelledby="terminal-profile-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shellProfiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {profileError && <p role="alert">{profileError}</p>}
          </div>
          <div
            className={styles.terminalLocationList}
            role="list"
            aria-label={t("terminal.locationTitle")}
          >
            <TerminalLocationRow
              icon={<House />}
              title={t("terminal.home")}
              description={t("terminal.homeDescription")}
              onSelect={() => openTerminal("home")}
            />
            {thread?.workspacePath && (
              <TerminalLocationRow
                icon={<Folder />}
                title={t("terminal.threadWorkspace")}
                description={thread.workspacePath}
                onSelect={() => openTerminal("thread")}
              />
            )}
            {workspaceBindings.map((binding) => {
              const location = `binding:${binding.id}`;
              const host = snapshot?.hosts.find((item) => item.id === binding.hostId);
              return (
                <TerminalLocationRow
                  key={binding.id}
                  icon={<Folder />}
                  title={binding.alias}
                  description={`${host?.displayName ?? binding.hostId} · ${binding.root}`}
                  onSelect={() => openTerminal(location)}
                />
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTerminalDialogOpen(false)}>
              {t("terminal.locationCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={remoteHostDialogOpen} onOpenChange={setRemoteHostDialogOpen}>
        <DialogContent className={styles.terminalDialog}>
          <DialogHeader>
            <DialogTitle>{t("remoteHostPicker.title")}</DialogTitle>
            <DialogDescription>{t("remoteHostPicker.description")}</DialogDescription>
          </DialogHeader>
          <div
            className={styles.terminalLocationList}
            role="list"
            aria-label={t("remoteHostPicker.title")}
          >
            {snapshot?.endpoints.map((endpoint) => {
              const available = isLinkEndpoint(endpoint) || Boolean(endpoint.spiceWebsocketUrl);
              const location = isLinkEndpoint(endpoint)
                ? t("remoteHostPicker.link")
                : endpoint.spiceWebsocketUrl
                  ? t("remoteHostPicker.spice")
                  : t("remoteHostPicker.unavailable");
              return (
                <TerminalLocationRow
                  key={endpoint.id}
                  icon={<MonitorUp />}
                  title={endpoint.displayName}
                  description={location}
                  disabled={!available}
                  onSelect={() => openRemoteHost(endpoint)}
                />
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoteHostDialogOpen(false)}>
              {t("terminal.locationCancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function isLinkEndpoint(endpoint: RemoteEndpointView): boolean {
  return endpoint.transport === "tunnel" || endpoint.transport === "link";
}

function TerminalLocationRow({
  icon,
  title,
  description,
  onSelect,
  disabled = false,
}: {
  icon: ReactElement;
  title: string;
  description: string;
  onSelect(): void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.terminalLocationRow} role="listitem">
      <Button
        variant="ghost"
        className={styles.terminalLocationChoice}
        disabled={disabled}
        onClick={onSelect}
      >
        <span className={styles.terminalLocationIcon}>{icon}</span>
        <span className={styles.terminalLocationText}>
          <strong className={styles.terminalLocationTitle}>{title}</strong>
          <small className={styles.terminalLocationDescription}>{description}</small>
        </span>
      </Button>
    </div>
  );
}

const StateProjectionFactory = create((dependsOn) => {
  const conversation = dependsOn(conversationTokens.conversationState);
  const workspace = dependsOn(workspaceTokens.workspaceState);
  const hosts = dependsOn(hostsTokens.hostsState);
  const reader = projectServices(
    [conversation, workspace, hosts] as const,
    (conversationState, workspaceState, hostsState) => ({
      snapshot:
        conversationState.snapshot && workspaceState.snapshot && hostsState.snapshot
          ? {
              ...conversationState.snapshot,
              ...workspaceState.snapshot,
              ...hostsState.snapshot,
              revision: [
                conversationState.snapshot.revision,
                workspaceState.snapshot.revision,
                hostsState.snapshot.revision,
              ].reduce((latest, value) => (value > latest ? value : latest), 0n),
            }
          : undefined,
      pending: conversationState.pending + workspaceState.pending + hostsState.pending,
      busy: conversationState.busy || workspaceState.busy || hostsState.busy,
      error: conversationState.error ?? workspaceState.error ?? hostsState.error,
    }),
  );
  return reader;
}, "PaneToolbarStateProjection");
