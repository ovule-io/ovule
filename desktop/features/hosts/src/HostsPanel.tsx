import shellTokens from "@ovule/shell/shell.token";
import hostsTokens from "./hosts.token";
import panesTokens from "@ovule/panes/panes.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import remotingTokens from "@ovule/remoting/remoting.token";
import type { ViewData } from "./view-data";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { useObservableState } from "@ovule/ioc/react";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  Link2,
  LoaderCircle,
  MonitorUp,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useService } from "@ovule/ioc/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ovule/ui/alert-dialog";
import { Button } from "@ovule/ui/button";
import { Checkbox, Input } from "@ovule/ui/form";
import { InputOTP, InputOTPGroup, InputOTPSlot, REGEXP_ONLY_DIGITS } from "@ovule/ui/input-otp";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ovule/ui/tabs";
import { Tooltip } from "@ovule/ui/tooltip";

import type { WorkspaceOperation } from "./operations";
import type {
  HostDeviceAccess,
  HostWorkspaceResource,
  RemoteEndpointView,
  ShareWorkspaceLinkResult,
} from "@ovule/shell-api";
import { createWorkspacePairingLink, parseWorkspacePairingLink } from "./pairing-link";
import type { WorkspacePairingLink } from "./pairing-link";
import { cn } from "@ovule/ui/cn";
import { nextRemoteHostStatus } from "./remote-host-status";
import type { RemoteHostStatus } from "./remote-host-status";
import styles from "./HostsPanel.module.css";
import settingsTokens from "@ovule/settings/settings.token";
import { HostPowerControl } from "./HostPowerControl";

type Props = {
  snapshot: ViewData;
  busy: boolean;
  selectedThreadId?: string;
  invoke(operation: WorkspaceOperation): Promise<boolean>;
};

type SharedWorkspace = {
  value: ShareWorkspaceLinkResult;
  link: string;
  copied: boolean;
};

type HostsPanelDependencies = {
  HostSpiceControl: ServiceOf<typeof HostSpiceControlFactory>;
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
  shell: ServiceOf<typeof shellTokens.shell>;
  viewState: ServiceOf<typeof hostsTokens.hostsViewState>;
};

function HostsPanelContent({
  dependencies,
  props,
}: {
  dependencies: HostsPanelDependencies;
  props: Props;
}) {
  const { encodeLinkRemoteControlSession } = useService(remotingTokens.sessionLinks);
  const { copyText } = useService(shellTokens.shell);

  const i18n = useTranslation().i18n;

  const { HostSpiceControl, workspace, shell, viewState } = dependencies;
  const DesktopPermissionsControl = useService(settingsTokens.desktopPermissionsView);
  const { snapshot, busy, selectedThreadId, invoke } = props;

  useTranslation();
  const [pairingLink, setPairingLink] = useState("");
  const [candidate, setCandidate] = useState<WorkspacePairingLink>();
  const [connectionStatus, setConnectionStatus] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [hostShare, setHostShare] = useState<SharedWorkspace>();
  const [pairLinkVisible, setPairLinkVisible] = useState(false);
  const [shareStatus, setShareStatus] = useState<string>();
  const [refreshingHostId, setRefreshingHostId] = useState<string>();
  const [confirmingRemoveHostId, setConfirmingRemoveHostId] = useState<string>();
  const [removingHostId, setRemovingHostId] = useState<string>();
  const [hiddenHostIds, setHiddenHostIds] = useState<Set<string>>(() => new Set());
  const [remoteHostStatus, setRemoteHostStatus] = useState<Record<string, RemoteHostStatus>>({});
  const [resettingLinkData, setResettingLinkData] = useState(false);
  const [hostRepairError, setHostRepairError] = useState<string>();
  const { clearedLegacyLinkKey, hiddenHostIdentityId } = useObservableState(
    viewState,
    (state) => state,
  );
  const copyResetTimer = useRef<number | undefined>(undefined);
  const removedHostIds = useRef(new Set<string>());
  const threadId = selectedThreadId || snapshot.threads[0]?.id;
  const remoteHosts = useMemo(
    () =>
      snapshot.endpoints.filter(
        (endpoint) => endpoint.transport === "tunnel" && !hiddenHostIds.has(endpoint.id),
      ),
    [hiddenHostIds, snapshot.endpoints],
  );
  const remoteHostStatusKey = remoteHosts
    .map((endpoint) => `${endpoint.id}\0${endpoint.host ?? ""}\0${endpoint.user ?? ""}`)
    .join("\n");
  const legacyLinkKey = [
    ...remoteHosts
      .filter((endpoint) => !endpoint.remoteId)
      .map((endpoint) => `host:${endpoint.id}`),
    ...snapshot.bindings
      .filter((binding) => binding.kind === "tunnel" && !binding.resourceId)
      .map((binding) => `binding:${binding.id}`),
  ]
    .sort()
    .join("\n");
  const clientLinkDataNeedsReset = Boolean(legacyLinkKey) && clearedLegacyLinkKey !== legacyLinkKey;
  const hostAccessNeedsRepair = Boolean(hostShare?.value.requiresReset);
  const showLegacyDataNotice = hostAccessNeedsRepair || clientLinkDataNeedsReset;

  const importLink = () => {
    try {
      setCandidate(parseWorkspacePairingLink(pairingLink));
      setConnectionStatus(undefined);
      setAwaitingApproval(false);
      setPairingCode("");
    } catch (error) {
      setCandidate(undefined);
      setConnectionStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const connect = async () => {
    if (!candidate || busy || connecting) return;
    setConnecting(true);
    setConnectionStatus(i18n.t("hosts.connectingSecurely"));
    try {
      const tested = await workspace
        .api()
        .then((api) => api.testWorkspaceLink(candidate.endpointAddrJson, candidate.shareId));
      if (!tested.connected) {
        setAwaitingApproval(true);
        setConnectionStatus(i18n.t("hosts.enterThe6digitCodeShownOnTheHost"));
        return;
      }
      const connected = await invoke(async (api) => {
        const registered = await api.registerEndpoint({
          displayName: candidate.name,
          transport: "tunnel",
          host: candidate.endpointAddrJson,
          user: candidate.shareId,
          agentIds: tested.agentIds,
          workspaces: tested.workspaces,
        });
        return registered.snapshot;
      });
      if (connected) {
        setConnectionStatus(i18n.t("hosts.remoteHostConnectedChooseAWorkspaceBelow"));
        setCandidate(undefined);
        setPairingLink("");
      } else {
        setConnectionStatus(i18n.t("hosts.remoteHostCouldNotBeSavedTryConnecting"));
      }
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  };

  const bindRemoteWorkspace = async (
    endpoint: RemoteEndpointView,
    resource: HostWorkspaceResource,
  ) => {
    if (!threadId) return;
    const attached = await invoke(async (api) => {
      await api.bindWorkspace({
        threadId,
        kind: "tunnel",
        endpointId: endpoint.id,
        resourceId: resource.shareId,
        root: resource.root,
        alias: resource.alias,
      });
      return api.selectHost(threadId, endpoint.id);
    });
    if (attached)
      setConnectionStatus(i18n.t("hosts.workspaceAttached", { workspace: resource.alias }));
  };

  const approveLocalPairing = async () => {
    if (!candidate || pairingCode.length !== 6 || busy || pairing) return;
    setPairing(true);
    try {
      await workspace
        .api()
        .then((api) =>
          api.submitWorkspaceLinkPairing(
            candidate.endpointAddrJson,
            candidate.shareId,
            pairingCode,
          ),
        );
      setConnectionStatus(i18n.t("hosts.pairingAcceptedConnecting"));
      setAwaitingApproval(false);
      await connect();
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPairing(false);
    }
  };

  const refreshHostStatus = async () => {
    try {
      const value = await workspace.api().then((api) => api.shareHostLink());
      setHostShare((current) => hostShareValue(value, current?.copied ?? false));
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const copyHostLink = async () => {
    if (!hostShare) return;
    const copied = await copyText(hostShare.link);
    setHostShare({ ...hostShare, copied });
    if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
    if (copied) {
      copyResetTimer.current = window.setTimeout(() => {
        setHostShare((current) => (current ? { ...current, copied: false } : current));
      }, 5_000);
    }
    setShareStatus(
      copied
        ? i18n.t("hosts.pairLinkCopiedKeepOvuleRunningOnThis")
        : i18n.t("hosts.copyFailedSelectTheLinkAndCopyIt"),
    );
  };

  const regenerateHostLink = async () => {
    try {
      const value = await workspace.api().then((api) => api.regenerateHostLink());
      setHostShare(hostShareValue(value, false));
      setPairLinkVisible(false);
      setShareStatus(i18n.t("hosts.pairLinkRegeneratedPreviouslyCopiedLinksCanNo"));
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const unbindRemoteHost = async (endpoint: RemoteEndpointView) => {
    if (!threadId) return;
    const changed = await invoke((api) => api.unbindRemoteHost(threadId, endpoint.id));
    if (changed) setConnectionStatus(i18n.t("hosts.hostUnbound", { host: endpoint.displayName }));
  };

  const removeRemoteHost = async (endpoint: RemoteEndpointView) => {
    removedHostIds.current.add(endpoint.id);
    setHiddenHostIds((current) => new Set(current).add(endpoint.id));
    setRemovingHostId(endpoint.id);
    setConnectionStatus(i18n.t("hosts.removingHost", { host: endpoint.displayName }));
    try {
      const changed = await invoke((api) => api.removeRemoteHost(endpoint.id));
      if (changed) {
        setRemoteHostStatus((current) => {
          const next = { ...current };
          delete next[endpoint.id];
          return next;
        });
        setConnectionStatus(i18n.t("hosts.hostRemoved", { host: endpoint.displayName }));
      } else {
        removedHostIds.current.delete(endpoint.id);
        setHiddenHostIds((current) => {
          const next = new Set(current);
          next.delete(endpoint.id);
          return next;
        });
        setConnectionStatus(i18n.t("hosts.hostRemoveFailed", { host: endpoint.displayName }));
      }
    } catch (error) {
      removedHostIds.current.delete(endpoint.id);
      setHiddenHostIds((current) => {
        const next = new Set(current);
        next.delete(endpoint.id);
        return next;
      });
      setConnectionStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirmingRemoveHostId(undefined);
      setRemovingHostId(undefined);
    }
  };

  const resetLegacyLinkData = async () => {
    setResettingLinkData(true);
    try {
      const changed = await invoke((api) => api.resetLinkHosts());
      if (changed) {
        viewState.patch({ clearedLegacyLinkKey: legacyLinkKey });
        setCandidate(undefined);
        setPairingLink("");
        setPairLinkVisible(false);
        await refreshHostStatus();
        setConnectionStatus(i18n.t("hosts.linkHostsBindingsPairedDevicesGrantsAndShared"));
      }
    } finally {
      setResettingLinkData(false);
    }
  };

  const repairLocalHostData = async () => {
    setHostRepairError(undefined);
    setResettingLinkData(true);
    try {
      const value = await workspace.api().then((api) => api.repairLocalHostAccess());
      setHostShare(hostShareValue(value, false));
      setPairLinkVisible(false);
      setShareStatus(i18n.t("hosts.thisHostWasRepairedShareItsNewPair"));
    } catch (error) {
      setHostRepairError(error instanceof Error ? error.message : String(error));
    } finally {
      setResettingLinkData(false);
    }
  };

  const resetLocalHostIdentity = async () => {
    setHostRepairError(undefined);
    setShareStatus(i18n.t("hosts.resettingThisHostLinkIdentity"));
    setResettingLinkData(true);
    try {
      const value = await workspace.api().then((api) => api.resetLocalHostLinkIdentity());
      setHostShare(hostShareValue(value, false));
      viewState.patch({ hiddenHostIdentityId: value.endpointId });
      setPairLinkVisible(false);
      setShareStatus(i18n.t("hosts.thisHostLinkIdentityWasResetCloseAny"));
      await refreshHostStatus();
    } catch (error) {
      setHostRepairError(error instanceof Error ? error.message : String(error));
      setShareStatus(undefined);
    } finally {
      setResettingLinkData(false);
    }
  };

  const updateDeviceAccess = async (
    clientId: string,
    workspaceIds: string[],
    agentIds: string[],
  ) => {
    setHostShare((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              devices: current.value.devices.map((device) =>
                device.clientId === clientId ? { ...device, workspaceIds, agentIds } : device,
              ),
            },
          }
        : current,
    );
    try {
      await workspace
        .api()
        .then((api) => api.setWorkspaceLinkAccess({ clientId, workspaceIds, agentIds }));
      setShareStatus(i18n.t("hosts.deviceAccessUpdatedThePairedDeviceCanRefresh"));
      await refreshHostStatus();
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : String(error));
      await refreshHostStatus();
    }
  };

  const addWorkspaceToDevice = async (device: HostDeviceAccess) => {
    const root = await shell.dialog().then((dialog) =>
      dialog.openDirectory({
        title: i18n.t("hosts.addWorkspaceForDevice", { device: device.name }),
      }),
    );
    if (!root) return;
    try {
      const alias = root.split(/[\\/]/).filter(Boolean).at(-1) || "workspace";
      const before = new Set(hostShare?.value.workspaces.map((item) => item.shareId) ?? []);
      const value = await workspace.api().then((api) => api.shareWorkspaceLink(root, alias));
      const resource =
        value.workspaces.find((item) => !before.has(item.shareId)) ??
        value.workspaces.find((item) => sameHostPath(item.root, root));
      if (!resource) throw new Error(i18n.t("hosts.hostDidNotReturnTheAddedWorkspaceResource"));
      await workspace.api().then((api) =>
        api.setWorkspaceLinkAccess({
          clientId: device.clientId,
          workspaceIds: [...new Set([...device.workspaceIds, resource.shareId])],
          agentIds: device.agentIds,
        }),
      );
      setHostShare(hostShareValue(value, hostShare?.copied ?? false));
      await refreshHostStatus();
      setShareStatus(
        i18n.t("hosts.workspaceAddedForDevice", {
          workspace: resource.alias,
          device: device.name,
        }),
      );
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const refreshRemoteHost = async (endpoint: RemoteEndpointView) => {
    const address = endpoint.host;
    if (!address || removedHostIds.current.has(endpoint.id)) return;
    setRefreshingHostId(endpoint.id);
    try {
      const tested = await workspace
        .api()
        .then((api) => api.testWorkspaceLink(address, endpoint.user ?? "host"));
      if (removedHostIds.current.has(endpoint.id)) return;
      if (!tested.connected) throw new Error(tested.detail);
      setRemoteHostStatus((current) => ({
        ...current,
        [endpoint.id]: nextRemoteHostStatus(current[endpoint.id], true, tested.detail),
      }));
      await invoke(async (api) => {
        const registered = await api.registerEndpoint({
          displayName: endpoint.displayName,
          transport: endpoint.transport,
          host: endpoint.host,
          port: endpoint.port,
          user: endpoint.user,
          authKind: endpoint.authKind,
          hostFingerprint: endpoint.hostFingerprint,
          agentIds: tested.agentIds,
          workspaces: tested.workspaces,
        });
        return registered.snapshot;
      });
      setConnectionStatus(i18n.t("hosts.hostRefreshed", { host: endpoint.displayName }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setRemoteHostStatus((current) => ({
        ...current,
        [endpoint.id]: nextRemoteHostStatus(current[endpoint.id], false, detail),
      }));
      setConnectionStatus(detail);
    } finally {
      setRefreshingHostId(undefined);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      const api = await workspace.api();
      const result = await api.shareHostLink();
      if (!active) return;
      setHostShare((current) => hostShareValue(result, current?.copied ?? false));
    })().catch((error: unknown) => {
      if (!active) return;
      setShareStatus(error instanceof Error ? error.message : String(error));
    });
    return () => {
      active = false;
    };
  }, [workspace]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const schedulePoll = () => {
      if (active) timer = window.setTimeout(runPoll, 3_000);
    };
    const poll = async () => {
      const api = await workspace.api();
      await Promise.all(
        remoteHosts.map(async (endpoint) => {
          if (!endpoint.host) return;
          let connected = false;
          let detail = i18n.t("hosts.hostDidNotCompleteTheOvuleLinkHandshake");
          let capabilities: string[] = [];
          try {
            const tested = await api.testWorkspaceLink(endpoint.host, endpoint.user ?? "host");
            connected = tested.connected;
            detail = tested.detail;
            capabilities = tested.capabilities;
          } catch (error) {
            detail = error instanceof Error ? error.message : String(error);
          }
          if (active) {
            setRemoteHostStatus((current) => ({
              ...current,
              [endpoint.id]: nextRemoteHostStatus(
                current[endpoint.id],
                connected,
                detail,
                capabilities,
              ),
            }));
          }
        }),
      );
      schedulePoll();
    };
    const runPoll = () => {
      void poll().catch((error: unknown) => {
        if (active) setConnectionStatus(error instanceof Error ? error.message : String(error));
        schedulePoll();
      });
    };
    runPoll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [remoteHostStatusKey, remoteHosts, workspace]);

  useEffect(() => {
    if (!hostShare) return;
    const timer = window.setInterval(() => void refreshHostStatus(), 1_000);
    return () => window.clearInterval(timer);
  }, [hostShare]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
    },
    [],
  );

  return (
    <section className={styles.workspaceCenter} aria-label={i18n.t("hosts.title")}>
      <HostPowerControl />
      <DesktopPermissionsControl />
      <Tabs defaultValue="paired-devices" className={styles.hostTabs}>
        <TabsList className={styles.hostTabsList} aria-label={i18n.t("hosts.hostConnections")}>
          <TabsTrigger
            className={styles.hostTabTrigger}
            value="paired-devices"
            data-host-tab="paired-devices"
          >
            <ShieldCheck size={15} />
            {i18n.t("hosts.pairedDevices")}{" "}
            <span className={styles.hostTabCount}>{hostShare?.value.devices.length ?? 0}</span>
          </TabsTrigger>
          <TabsTrigger
            className={styles.hostTabTrigger}
            value="remote-hosts"
            data-host-tab="remote-hosts"
          >
            <Link2 size={15} />
            {i18n.t("composer.remoteHosts")}{" "}
            <span className={styles.hostTabCount}>{remoteHosts.length}</span>
          </TabsTrigger>
        </TabsList>
        {showLegacyDataNotice && (
          <div className={styles.legacyDataNotice}>
            <div className={styles.workspaceBindingText}>
              <strong className={styles.workspaceStrong}>
                {hostAccessNeedsRepair
                  ? i18n.t("hosts.thisHostAuthorizationDataNeedsRepair")
                  : i18n.t("hosts.outdatedLocalLinkRecordsDetected")}
              </strong>
              <small className={styles.workspaceMutedText}>
                {hostAccessNeedsRepair
                  ? i18n.t("hosts.repairResetsIncomingPairingsAndGrantsOnThis")
                  : i18n.t("hosts.resetClearsThisDevicesSavedLinkConnectionsAnd")}
              </small>
            </div>
            <Button
              className={styles.legacyResetButton}
              variant="danger"
              size="sm"
              disabled={resettingLinkData}
              onClick={() =>
                void (hostAccessNeedsRepair ? repairLocalHostData() : resetLegacyLinkData())
              }
            >
              {resettingLinkData
                ? i18n.t("hosts.clearing")
                : hostAccessNeedsRepair
                  ? i18n.t("hosts.repairThisHost")
                  : i18n.t("hosts.resetLinkConnections")}
            </Button>
            {hostRepairError && <p role="alert">{hostRepairError}</p>}
          </div>
        )}
        <TabsContent
          className={styles.hostTabContent}
          value="paired-devices"
          data-host-tab-content="paired-devices"
        >
          <section className={styles.workspaceConnect} aria-labelledby="paired-devices-title">
            <h3 id="paired-devices-title" className="sr-only">
              {i18n.t("hosts.pairedDevices")}{" "}
            </h3>
            <div className={cn("workspace-section-heading", styles.workspaceSectionHeading)}>
              <p className={cn(styles.workspaceParagraph, styles.workspaceSectionDescription)}>
                {i18n.t("hosts.pairOnceThenGrantEachDeviceOnlyThe")}{" "}
              </p>
              <Button
                variant="ghost"
                size="icon"
                aria-label={i18n.t("hosts.refreshPairedDevices")}
                title={i18n.t("hosts.refreshPairedDevices")}
                onClick={() => void refreshHostStatus()}
              >
                <RefreshCw size={15} />
              </Button>
            </div>
            {hostShare && !hostShare.value.requiresReset && (
              <div className={styles.hostPairLinkBlock}>
                <div className={styles.workspaceBindingText}>
                  <strong className={styles.workspaceStrong}>
                    {" "}
                    {i18n.t("hosts.thisHostPairLink")}{" "}
                  </strong>
                  <small className={styles.workspaceMutedText}>
                    {i18n.t("hosts.sendThisLinkToAClientDeviceIt")}{" "}
                  </small>
                </div>
                <div className={styles.pairLinkControl}>
                  <Input
                    className={styles.pairLinkInput}
                    aria-label={i18n.t("hosts.thisHostPairLink")}
                    type={pairLinkVisible ? "text" : "password"}
                    value={hostShare.link}
                    readOnly
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      pairLinkVisible ? i18n.t("hosts.hidePairLink") : i18n.t("hosts.showPairLink")
                    }
                    title={
                      pairLinkVisible ? i18n.t("hosts.hidePairLink") : i18n.t("hosts.showPairLink")
                    }
                    onClick={() => setPairLinkVisible((visible) => !visible)}
                  >
                    {pairLinkVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("hosts.copyThisHostPairLink")}
                    title={i18n.t("hosts.copyPairLink")}
                    onClick={() => void copyHostLink()}
                  >
                    {hostShare.copied ? <Check size={15} /> : <Copy size={15} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={i18n.t("hosts.regenerateThisHostPairLink")}
                    title={i18n.t("hosts.regeneratePairLink")}
                    onClick={() => void regenerateHostLink()}
                  >
                    <RotateCw size={15} />
                  </Button>
                </div>
                {hostShare.value.pending.map((request) => (
                  <div className={styles.pairingRequestInline} key={request.clientId}>
                    <span
                      className={styles.workspacePairingCode}
                      aria-label={i18n.t("hosts.hostPairingCode")}
                    >
                      {request.code}
                    </span>
                    <div className={styles.workspacePairRequestText}>
                      <strong className={styles.workspaceStrong}>{request.name}</strong>
                      <small className={styles.workspacePairRequestDescription}>
                        {request.clientId.slice(0, 20)} {i18n.t("hosts.wantsToPair")}{" "}
                      </small>
                    </div>
                  </div>
                ))}
                {hiddenHostIdentityId !== hostShare.value.endpointId && (
                  <>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="danger" size="sm" disabled={resettingLinkData}>
                          {resettingLinkData && <LoaderCircle className="spin" size={14} />}
                          {i18n.t("hosts.resetThisHostLinkIdentity2")}{" "}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {" "}
                            {i18n.t("hosts.resetThisHostLinkIdentity")}{" "}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {i18n.t("hosts.allIncomingPairingsGrantsAndExistingPairLinks")}{" "}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel asChild>
                            <Button variant="ghost"> {i18n.t("catalog.cancel")} </Button>
                          </AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <Button variant="danger" onClick={() => void resetLocalHostIdentity()}>
                              {i18n.t("hosts.resetHostIdentity")}{" "}
                            </Button>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <small className={styles.workspaceMutedText}>
                      {i18n.t("hosts.useThisWhenAnOldBuildOrStale")}{" "}
                    </small>
                  </>
                )}
              </div>
            )}
            <div className={styles.deviceList}>
              {hostShare?.value.devices.map((device) => (
                <article className={styles.workspaceDeviceAccess} key={device.clientId}>
                  <header className={styles.workspaceDeviceHeader}>
                    <div className={styles.workspacePairRequestText}>
                      <div className={styles.statusIdentity}>
                        <span
                          className={cn(styles.statusDot, device.online && styles.statusDotOnline)}
                          aria-hidden="true"
                        />
                        <strong className={styles.workspaceStrong}>{device.name}</strong>
                        <span className={styles.connectionState}>
                          {device.online ? i18n.t("hosts.online") : i18n.t("hosts.offline")}
                        </span>
                      </div>
                      <small className={styles.workspacePairRequestDescription}>
                        {device.clientId}
                      </small>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={i18n.t("hosts.revokeDeviceNamed", {
                        device: device.name,
                      })}
                      title={i18n.t("hosts.revokeDevice")}
                      onClick={() =>
                        void workspace.api().then(async (api) => {
                          await api.revokeWorkspaceLink(hostShare.value.shareId, device.clientId);
                          await refreshHostStatus();
                        })
                      }
                    >
                      <Unplug size={15} />
                    </Button>
                  </header>
                  <fieldset className={styles.workspaceGrantGroup}>
                    <legend> {i18n.t("onboarding.agents")} </legend>
                    <div className={styles.agentGrantList}>
                      {hostShare.value.agents.map((agent) => (
                        <label className={styles.workspaceGrantOption} key={agent.id}>
                          <Checkbox
                            checked={device.agentIds.includes(agent.id)}
                            onChange={() =>
                              void updateDeviceAccess(
                                device.clientId,
                                device.workspaceIds,
                                device.agentIds.includes(agent.id)
                                  ? device.agentIds.filter((id) => id !== agent.id)
                                  : [...device.agentIds, agent.id],
                              )
                            }
                          />
                          <span>{agent.id}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className={styles.deviceWorkspaceBlock}>
                    <div className={styles.deviceWorkspaceHeader}>
                      <strong className={styles.workspaceStrong}>
                        {" "}
                        {i18n.t("hosts.workspaces")}{" "}
                      </strong>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={i18n.t("hosts.addWorkspaceForDevice", {
                          device: device.name,
                        })}
                        title={i18n.t("hosts.addWorkspace")}
                        onClick={() => void addWorkspaceToDevice(device)}
                      >
                        <FolderPlus size={15} />
                      </Button>
                    </div>
                    {device.workspaceIds.length === 0 && (
                      <small className={styles.workspaceMutedText}>
                        {" "}
                        {i18n.t("hosts.noWorkspaceGranted")}{" "}
                      </small>
                    )}
                    {device.workspaceIds.map((workspaceId) => {
                      const resource = hostShare.value.workspaces.find(
                        (item) => item.shareId === workspaceId,
                      );
                      if (!resource) return null;
                      return (
                        <div className={styles.workspaceBinding} key={workspaceId}>
                          <div className={styles.workspaceBindingText}>
                            <strong>{resource.alias}</strong>
                            <small className={styles.workspaceBindingPath}>{resource.root}</small>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={i18n.t("hosts.removeWorkspaceFromDevice", {
                              workspace: resource.alias,
                              device: device.name,
                            })}
                            title={i18n.t("hosts.removeWorkspaceGrant")}
                            onClick={() =>
                              void updateDeviceAccess(
                                device.clientId,
                                device.workspaceIds.filter((id) => id !== workspaceId),
                                device.agentIds,
                              )
                            }
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
              {hostShare?.value.devices.length === 0 && (
                <p className={styles.emptyState}> {i18n.t("hosts.noPairedDevicesYet")} </p>
              )}
            </div>
            {shareStatus && (
              <p className={styles.workspaceShareStatus} role="status">
                {shareStatus}
              </p>
            )}
          </section>
        </TabsContent>

        <TabsContent
          className={styles.hostTabContent}
          value="remote-hosts"
          data-host-tab-content="remote-hosts"
        >
          <section className={styles.workspaceConnect} aria-labelledby="remote-hosts-title">
            <h3 id="remote-hosts-title" className="sr-only">
              {i18n.t("composer.remoteHosts")}{" "}
            </h3>
            <div className={cn("workspace-section-heading", styles.workspaceSectionHeading)}>
              <p className={cn(styles.workspaceParagraph, styles.workspaceSectionDescription)}>
                {i18n.t("hosts.connectToAHostThenBindAnyGranted")}{" "}
              </p>
            </div>
            <div className={styles.workspaceLinkRow}>
              <Input
                aria-label={i18n.t("hosts.ovuleLink")}
                value={pairingLink}
                onChange={(event) => setPairingLink(event.target.value)}
                placeholder="ovule://app/hosts/link?…"
                disabled={connecting || pairing}
              />
              <Button disabled={connecting || pairing} onClick={importLink}>
                {i18n.t("onboarding.continue")}{" "}
              </Button>
            </div>
            {candidate && (
              <div className={styles.workspaceConnectCard}>
                <div className={styles.workspaceSummary}>
                  <ShieldCheck className={styles.workspaceSummaryIcon} size={18} />
                  <div className={styles.workspaceSummaryText}>
                    <strong className={styles.workspaceStrong}>{candidate.name}</strong>
                    <span className={styles.workspaceSummaryLine}>
                      {i18n.t("hosts.endtoendEncryptedHost")} {candidate.endpointId.slice(0, 16)}…
                    </span>
                  </div>
                </div>
                <Button disabled={busy || connecting || pairing} onClick={() => void connect()}>
                  {connecting ? (
                    <>
                      <LoaderCircle className="spin" size={14} /> {i18n.t("hosts.connecting")}{" "}
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
                {awaitingApproval && (
                  <div className={styles.workspacePairCode}>
                    <InputOTP
                      aria-label={i18n.t("hosts.pairingCode")}
                      maxLength={6}
                      pattern={REGEXP_ONLY_DIGITS}
                      value={pairingCode}
                      onChange={setPairingCode}
                    >
                      <InputOTPGroup>
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    <Button
                      disabled={pairingCode.length !== 6 || busy || pairing || connecting}
                      onClick={() => void approveLocalPairing()}
                    >
                      {pairing ? (
                        <>
                          <LoaderCircle className="spin" size={14} /> {i18n.t("hosts.pairing")}{" "}
                        </>
                      ) : (
                        i18n.t("hosts.pairConnect")
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {connectionStatus && (
              <p className={cn("workspace-status", styles.workspaceStatus)} role="status">
                {connectionStatus}
              </p>
            )}
            <div className={styles.remoteHostList}>
              {remoteHosts.map((endpoint) => {
                const status = remoteHostStatus[endpoint.id];
                const threadBindings = snapshot.bindings.filter(
                  (binding) => binding.threadId === threadId && binding.endpointId === endpoint.id,
                );
                return (
                  <article className={styles.remoteHostGroup} key={endpoint.id}>
                    <header className={styles.remoteHostHeader}>
                      <div className={styles.workspaceBindingText}>
                        <div className={styles.statusIdentity}>
                          <span
                            className={cn(
                              styles.statusDot,
                              (status?.phase === "online" || status?.phase === "reconnecting") &&
                                styles.statusDotOnline,
                            )}
                            aria-hidden="true"
                          />
                          <strong className={styles.workspaceStrong}>{endpoint.displayName}</strong>
                          <span className={styles.connectionState} title={status?.detail}>
                            {status?.phase === "online"
                              ? i18n.t("hosts.online")
                              : status?.phase === "reconnecting"
                                ? i18n.t("hosts.reconnecting")
                                : status?.phase === "offline"
                                  ? i18n.t("hosts.offline")
                                  : i18n.t("hosts.checking")}
                          </span>
                        </div>
                        <small
                          className={styles.remoteHostMeta}
                          title={endpoint.remoteId ?? endpoint.id}
                        >
                          {endpoint.remoteId ?? endpoint.id}
                        </small>
                        {status && status.phase !== "online" && (
                          <small className={styles.workspaceMutedText}>{status.detail}</small>
                        )}
                      </div>
                      <div className={styles.remoteHostActions}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!threadId || threadBindings.length === 0 || busy}
                          onClick={() => void unbindRemoteHost(endpoint)}
                        >
                          <Unplug size={14} /> {i18n.t("hosts.unbind")}{" "}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={refreshingHostId === endpoint.id}
                          aria-label={i18n.t("hosts.refreshHostNamed", {
                            host: endpoint.displayName,
                          })}
                          title={i18n.t("hosts.refreshHostInventory")}
                          onClick={() => void refreshRemoteHost(endpoint)}
                        >
                          <RefreshCw
                            className={refreshingHostId === endpoint.id ? "spin" : undefined}
                            size={15}
                          />
                        </Button>
                        <Button
                          variant={confirmingRemoveHostId === endpoint.id ? "danger" : "ghost"}
                          size={
                            confirmingRemoveHostId === endpoint.id || removingHostId === endpoint.id
                              ? "sm"
                              : "icon"
                          }
                          disabled={removingHostId === endpoint.id}
                          aria-label={
                            removingHostId === endpoint.id
                              ? i18n.t("hosts.removingHostNamed", {
                                  host: endpoint.displayName,
                                })
                              : confirmingRemoveHostId === endpoint.id
                                ? i18n.t("hosts.confirmRemoveHostNamed", {
                                    host: endpoint.displayName,
                                  })
                                : i18n.t("hosts.removeHostNamed", {
                                    host: endpoint.displayName,
                                  })
                          }
                          title={
                            confirmingRemoveHostId === endpoint.id
                              ? i18n.t("hosts.confirmRemoval")
                              : i18n.t("hosts.removeRemoteHost")
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (confirmingRemoveHostId === endpoint.id) {
                              void removeRemoteHost(endpoint);
                            } else {
                              setConfirmingRemoveHostId(endpoint.id);
                              setConnectionStatus(
                                i18n.t("hosts.removeHostConfirmation", {
                                  host: endpoint.displayName,
                                }),
                              );
                            }
                          }}
                        >
                          {removingHostId === endpoint.id ? (
                            <LoaderCircle className="spin" size={15} />
                          ) : (
                            <Trash2 size={15} />
                          )}
                          {removingHostId === endpoint.id
                            ? i18n.t("hosts.removing")
                            : confirmingRemoveHostId === endpoint.id && "Remove"}
                        </Button>
                      </div>
                    </header>
                    <div className={styles.remoteHostAgents}>
                      <strong className={styles.workspaceStrong}>
                        {" "}
                        {i18n.t("onboarding.agents")}{" "}
                      </strong>
                      <span>{endpoint.agentIds.join(", ") || i18n.t("hosts.noneGranted")}</span>
                    </div>
                    <HostSpiceControl endpoint={endpoint} hostStatus={status} busy={busy} />
                    <div className={styles.remoteHostWorkspaces}>
                      <strong className={styles.workspaceStrong}>
                        {" "}
                        {i18n.t("hosts.workspaces")}{" "}
                      </strong>
                      {endpoint.workspaces.map((resource) => {
                        const binding = snapshot.bindings.find(
                          (item) =>
                            item.threadId === threadId &&
                            item.endpointId === endpoint.id &&
                            (item.resourceId === resource.shareId ||
                              (!item.resourceId && sameHostPath(item.root, resource.root))),
                        );
                        return (
                          <div className={styles.workspaceBinding} key={resource.shareId}>
                            <div className={styles.workspaceBindingText}>
                              <strong>{resource.alias}</strong>
                              <small className={styles.workspaceBindingPath}>{resource.root}</small>
                            </div>
                            {binding ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  void invoke((api) => api.unbindWorkspace(binding.id))
                                }
                              >
                                <Unplug size={14} /> {i18n.t("hosts.unbind")}{" "}
                              </Button>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={!threadId || busy}
                                onClick={() => void bindRemoteWorkspace(endpoint, resource)}
                              >
                                {i18n.t("hosts.bind")}{" "}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                      {endpoint.workspaces.length === 0 && (
                        <small className={styles.workspaceMutedText}>
                          {i18n.t("hosts.noWorkspaceGrantedRefreshAfterTheHostOwner")}{" "}
                        </small>
                      )}
                    </div>
                  </article>
                );
              })}
              {remoteHosts.length === 0 && (
                <p className={styles.emptyState}> {i18n.t("hosts.noRemoteHostsConnected")} </p>
              )}
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </section>
  );
}

export const HostsPanelFactory = create((dependsOn) => {
  const HostSpiceControl = dependsOn(HostSpiceControlFactory);
  const workspace = dependsOn(workspaceTokens.workspace);
  const shell = dependsOn(shellTokens.shell);
  const viewState = dependsOn(hostsTokens.hostsViewState);
  const dependencies = { HostSpiceControl, workspace, shell, viewState };
  return function HostsPanel(props: Props) {
    return createElement(HostsPanelContent, { dependencies, props });
  };
}, "HostsPanel");

export const HostsPanel = (...args: Parameters<ServiceOf<typeof HostsPanelFactory>>) =>
  createElement(useService(HostsPanelFactory), ...args);

const HostSpiceControlFactory = create((dependsOn) => {
  const explorer = dependsOn(panesTokens.panes);
  const { encodeLinkRemoteControlSession } = dependsOn(remotingTokens.sessionLinks);
  return function HostSpiceControl({
    endpoint,
    hostStatus,
    busy,
  }: {
    endpoint: RemoteEndpointView;
    hostStatus?: RemoteHostStatus;
    busy: boolean;
  }) {
    const { t } = useTranslation();
    const linkReady =
      hostStatus?.phase === "online" && hostStatus.capabilities.includes("desktop.control");

    const openDesktop = () => {
      const target = encodeLinkRemoteControlSession({
        endpointId: endpoint.id,
        displayName: endpoint.displayName,
      });
      const existing = explorer
        .current()
        .instances.find((tab) => tab.kind === "spice" && tab.target === target);
      if (existing) explorer.selectTab(existing.id);
      else explorer.openTab("spice", { target, autoLoad: true });
    };

    return (
      <section
        className={styles.remoteControlSection}
        aria-label={t("hosts.spice.region", { host: endpoint.displayName })}
      >
        <div className={styles.workspaceBinding} data-remote-control-card>
          <div className={styles.workspaceBindingText}>
            <strong className={styles.workspaceStrong}>{t("hosts.spice.label")}</strong>
            <small className={styles.workspaceBindingPath}>
              {linkReady
                ? t("hosts.spice.ready")
                : hostStatus?.phase === "online"
                  ? t("hosts.spice.updateRequired")
                  : t("hosts.spice.waiting")}
            </small>
          </div>
          <Tooltip side="left" content={t("hosts.spice.open")}>
            <Button
              size="sm"
              className={styles.hostSpiceOpen}
              aria-label={t("hosts.spice.open")}
              disabled={busy || !linkReady}
              onClick={openDesktop}
            >
              <MonitorUp size={16} />
            </Button>
          </Tooltip>
        </div>
      </section>
    );
  };
}, "HostSpiceControl");

const HostSpiceControl = (...args: Parameters<ServiceOf<typeof HostSpiceControlFactory>>) =>
  createElement(useService(HostSpiceControlFactory), ...args);

function sameHostPath(left: string, right: string) {
  return (
    left.replaceAll("\\", "/").toLocaleLowerCase() ===
    right.replaceAll("\\", "/").toLocaleLowerCase()
  );
}

function hostShareValue(value: ShareWorkspaceLinkResult, copied: boolean): SharedWorkspace {
  return {
    value,
    copied,
    link: createWorkspacePairingLink({
      endpointAddrJson: value.endpointAddrJson,
      endpointId: value.endpointId,
      shareId: value.shareId,
      name: value.alias,
      alias: value.alias,
    }),
  };
}
