import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import type { WorkspaceService } from "@ovule/workspace/workspace";
import { Button } from "@ovule/ui/button";
import { DialogFooter } from "@ovule/ui/dialog";
import { createElement, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  gateConnectionId,
  gateVerified,
  type GateConnection,
  type LarkGateKind,
} from "./lark-gate";

type Props = {
  kind: LarkGateKind;
  threadId: string;
  waiting: boolean;
  onVerified(): Promise<void>;
  onReject?(): Promise<void>;
  resolving?: boolean;
};
export function LarkGateContent({
  workspace,
  kind,
  threadId,
  waiting,
  onVerified,
  onReject,
  resolving = false,
}: Props & { workspace: WorkspaceService }) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<GateConnection[]>([]);
  const [connectionId, setConnectionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const extensionId = useRef<string>(undefined);
  const latest = useRef(onVerified);
  latest.current = onVerified;
  const verified = useRef(false);
  const selectedId = connectionId ?? gateConnectionId(connections, threadId);
  const selected = connections.find((item) => item.connectionId === selectedId);
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const run = useRef<(action: string) => Promise<void>>(async () => {});
  const completeGate = async (action: () => Promise<void>) => {
    if (!waiting || verified.current) return;
    verified.current = true;
    setContinuing(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      verified.current = false;
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setContinuing(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    const execute = async (action: string) => {
      if (running || disposed || verified.current) return;
      clearTimeout(timer);
      const selectedId = selection.current;
      running = true;
      setBusy(true);
      setError(undefined);
      try {
        const api = await workspace.api();
        const id =
          extensionId.current ??
          (await api.extensionCatalog()).messageBlocks.find(
            (block) =>
              block.hostRenderer === "channel-setup" && /lark|feishu/i.test(block.extensionId),
          )?.extensionId;
        if (!id) throw new Error(t("workflow.larkMissing"));
        if (disposed) return;
        extensionId.current = id;
        let result = await api.runExtensionAction({
          extensionId: id,
          actionId: action,
          connectionId: selectedId,
        });
        if (disposed) return;
        let data = JSON.parse(result.dataJson) as { connections?: GateConnection[] };
        const deadline = Date.now() + 120_000;
        while (
          data.connections?.some(
            (item) =>
              (selectedId === undefined || item.connectionId === selectedId) &&
              ["registering", "refreshing"].includes(item.state ?? ""),
          )
        ) {
          setConnections(data.connections);
          if (Date.now() > deadline) throw new Error(t("workflow.larkStillRunning"));
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (disposed) return;
          result = await api.runExtensionAction({
            extensionId: id,
            actionId: "status",
            connectionId: selectedId,
          });
          if (disposed) return;
          data = JSON.parse(result.dataJson) as { connections?: GateConnection[] };
        }
        if (!Array.isArray(data.connections)) throw new Error(t("workflow.gateFailed"));
        setConnections(data.connections);
        const currentId = connectionId ?? gateConnectionId(data.connections, threadId);
        const current = data.connections.find((item) => item.connectionId === currentId);
        if (result.openUrl && action === "connect-existing")
          workspace.requestBrowserUse(result.openUrl);
        if (waiting && current && gateVerified(kind, current) && !verified.current) {
          verified.current = true;
          try {
            await latest.current();
          } catch (failure) {
            verified.current = false;
            throw failure;
          }
        }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        running = false;
        if (!disposed) {
          setBusy(false);
          if (waiting && !verified.current) timer = setTimeout(() => void execute("status"), 2500);
        }
      }
    };
    run.current = execute;
    void execute("status");
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [workspace, connectionId, kind, waiting, threadId, t]);
  const command =
    selected?.connected && selected.state !== "error" && selected.pairingCode
      ? `/pair ${selected.pairingCode}`
      : undefined;
  const policyDenied = /21001|access_policy_denied|access denied by access control policy/i.test(
    `${selected?.detail ?? ""} ${error ?? ""}`,
  );
  return (
    <section className="grid gap-3 py-2" data-lark-gate={kind} aria-busy={busy || continuing}>
      <p className="text-(--muted-foreground)">
        {t(
          kind === "pair" && !command && !selected?.ownerPaired
            ? "workflow.larkPairDisconnected"
            : `workflow.larkGuide.${kind}`,
        )}
      </p>
      {connections.length > 1 && (
        <label className="grid gap-1">
          {t("messageList.botConnection")}
          <select
            value={selectedId ?? ""}
            onChange={(event) => {
              verified.current = false;
              setConnectionId(event.target.value);
            }}
          >
            <option value="" disabled>
              {t("messageList.connectSelectedBot")}
            </option>
            {connections.map((item) => (
              <option key={item.connectionId} value={item.connectionId}>
                {item.botName || item.appIdHint || item.connectionId}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected?.detail && !policyDenied && (
        <p
          role={selected.state === "error" ? "alert" : "status"}
          className={selected.state === "error" ? "text-(--danger)" : "text-(--muted-foreground)"}
        >
          {selected.detail}
        </p>
      )}
      {policyDenied && (
        <p role="alert" className="text-(--danger)">
          {t("workflow.larkPolicyDenied")}
        </p>
      )}
      {kind === "pair" && !selected?.ownerPaired && (
        <div className="grid gap-2 rounded-lg bg-(--muted) p-3">
          <span>
            {t(command ? "messageList.privateChatPairing" : "workflow.larkPairUnavailable")}
          </span>
          {command && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="select-all text-lg">{command}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(command)
                    .then(() => setCopied(true))
                    .catch((failure: unknown) => setError(String(failure)));
                }}
              >
                {t(copied ? "workflow.larkCopied" : "workflow.larkCopy")}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || continuing || resolving || !selectedId}
          onClick={() => void run.current("connect-existing")}
        >
          {t("workflow.larkAuthorize")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy || continuing || resolving || !selectedId}
          onClick={() => void run.current("refresh")}
        >
          {t("messageList.refresh")}
        </Button>
      </div>
      {error && !policyDenied && (
        <p role="alert" className="text-(--danger)">
          {error}
        </p>
      )}
      {policyDenied && (
        <details className="text-sm text-(--muted-foreground)" data-lark-error-details>
          <summary className="cursor-pointer">{t("workflow.larkErrorDetails")}</summary>
          <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {error || selected?.detail}
          </p>
        </details>
      )}
      {waiting && (
        <>
          <p className="text-(--muted-foreground) text-sm">{t("workflow.larkManualHint")}</p>
          <DialogFooter data-lark-gate-actions>
            {onReject && (
              <Button
                variant="secondary"
                disabled={busy || continuing || resolving}
                onClick={() => void completeGate(onReject)}
              >
                {t("workflow.reject")}
              </Button>
            )}
            <Button
              data-lark-gate-continue
              disabled={busy || continuing || resolving}
              onClick={() => void completeGate(latest.current)}
            >
              {t(
                kind === "pair"
                  ? "workflow.larkContinuePair"
                  : "workflow.larkContinueAuthorization",
              )}
            </Button>
          </DialogFooter>
        </>
      )}
    </section>
  );
}
const factory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  return (props: Props) => createElement(LarkGateContent, { ...props, workspace });
}, "LarkGate");
export const LarkGate = (...args: Parameters<ServiceOf<typeof factory>>) =>
  useService(factory)(...args);
