import { ApprovalModePicker } from "./approval-mode";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Terminal } from "lucide-react";
import {
  Confirmation,
  ConfirmationContent,
  ConfirmationTitle,
  ConfirmationDescription,
  ConfirmationActions,
  ConfirmationAction,
} from "@ovule/ui/confirmation";
import { Checkbox } from "@ovule/ui/form";
import type { TFunction } from "i18next";
import styles from "./agent-approvals.module.css";

type Request = {
  requestId: string;
  attemptId: string;
  tool: string;
  arguments: unknown;
  automaticAllowed?: boolean;
  reviewFallback?: boolean;
};

/** Trusted host events feed inert, attempt-scoped inline cards; only explicit consent grants access. */
export function createAgentApprovals() {
  const requests = new Map<string, Request>();
  const listeners = new Set<() => void>();
  const presentedAttempts = new Set<string>();
  let installations = 0;
  let detach: (() => void) | undefined;
  let snapshot: Request[] = [];
  let revision = 0;
  const settled = new Set<string>();
  const emit = () => {
    snapshot = [...requests.values()];
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const respond = async (id: string, allow: boolean, automatic = false) => {
    if (!requests.has(id)) return;
    const api = await import("@ovule/shell-api");
    await api.agent.respondApprovalWithScope(id, allow, automatic);
    settled.add(id);
    if (settled.size > 256) settled.delete(settled.values().next().value!);
    revision++;
    requests.delete(id);
    emit();
  };
  function View({
    attemptId,
    translate,
    active = false,
  }: {
    attemptId: string;
    translate: TFunction;
    active?: boolean;
  }) {
    const [unavailable, setUnavailable] = useState(false);
    const pending = useSyncExternalStore(
      subscribe,
      () => snapshot,
      () => snapshot,
    );
    useEffect(() => {
      presentedAttempts.add(attemptId);
    }, [attemptId]);
    useEffect(() => {
      if (!active) return;
      let disposed = false;
      let inFlight = false;
      const sync = async () => {
        if (inFlight) return;
        inFlight = true;
        const started = revision;
        try {
          const api = await import("@ovule/shell-api");
          const pending = await api.agent.pendingApprovals(attemptId);
          if (disposed) return;
          setUnavailable(false);
          if (started !== revision) return;
          const live = new Set<string>();
          let changed = false;
          for (const item of pending) {
            if (
              item.attemptId !== attemptId ||
              !/^[a-f0-9]{32}$/.test(item.requestId) ||
              settled.has(item.requestId) ||
              Number(item.expiresAtMs) <= Date.now() ||
              item.argumentsJson.length > 16_384
            )
              continue;
            let argumentsValue: unknown;
            try {
              argumentsValue = JSON.parse(item.argumentsJson);
            } catch {
              continue;
            }
            live.add(item.requestId);
            if (
              !requests.has(item.requestId) ||
              requests.get(item.requestId)?.reviewFallback !== item.reviewFallback
            ) {
              requests.set(item.requestId, {
                requestId: item.requestId,
                attemptId,
                tool: item.tool,
                arguments: argumentsValue,
                automaticAllowed: item.automaticAllowed,
                reviewFallback: item.reviewFallback,
              });
              changed = true;
            }
          }
          for (const [id, request] of requests) {
            if (request.attemptId === attemptId && !live.has(id)) {
              requests.delete(id);
              changed = true;
            }
          }
          if (changed) emit();
        } catch {
          if (!disposed) setUnavailable(true);
        } finally {
          inFlight = false;
        }
      };
      void sync();
      const timer = setInterval(() => void sync(), 1000);
      const resume = () => {
        if (document.visibilityState === "visible") void sync();
      };
      document.addEventListener("visibilitychange", resume);
      return () => {
        disposed = true;
        clearInterval(timer);
        document.removeEventListener("visibilitychange", resume);
      };
    }, [attemptId, active]);
    const visible = pending.filter((request) => request.attemptId === attemptId);
    if (!visible.length && !unavailable) return null;
    return (
      <div className={styles.list} data-agent-approval-list={attemptId}>
        {unavailable && <p role="status">{translate("agentApproval.unavailable")}</p>}
        {visible.map((request) => (
          <ApprovalCard
            key={request.requestId}
            id={request.requestId}
            request={request}
            t={translate}
            respond={respond}
          />
        ))}
      </div>
    );
  }
  function install() {
    const bridge = (
      globalThis as typeof globalThis & {
        tuffite?: {
          addEventListener(type: string, handler: (event: Event) => void): void;
          removeEventListener(type: string, handler: (event: Event) => void): void;
        };
      }
    ).tuffite;
    if (!bridge) return () => {};
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ channel: string; data: Uint8Array }>).detail;
      if (
        detail?.channel !== "ovule:agent-approval" ||
        !(detail.data instanceof Uint8Array) ||
        detail.data.length > 32_768
      )
        return;
      let request: Request & { kind: string };
      try {
        request = JSON.parse(new TextDecoder().decode(detail.data));
      } catch {
        return;
      }
      if (
        !request ||
        typeof request !== "object" ||
        typeof request.requestId !== "string" ||
        !/^[a-f0-9]{32}$/.test(request.requestId)
      )
        return;
      if (request.kind === "closed") {
        revision++;
        settled.add(request.requestId);
        if (settled.size > 256) settled.delete(settled.values().next().value!);
        requests.delete(request.requestId);
        emit();
      } else if (
        request.kind === "request" &&
        typeof request.tool === "string" &&
        typeof request.attemptId === "string" &&
        requests.size < 32 &&
        !requests.has(request.requestId) &&
        !settled.has(request.requestId)
      ) {
        revision++;
        requests.set(request.requestId, request);
        emit();
      }
    };
    if (installations++ === 0) {
      bridge.addEventListener("channel", receive);
      detach = () => bridge.removeEventListener("channel", receive);
    }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (--installations > 0) return;
      detach?.();
      detach = undefined;
      for (const [id, request] of requests) {
        // A main/pane renderer must not deny a background thread's request
        // merely because it received the same broadcast event.
        if (!presentedAttempts.has(request.attemptId)) continue;
        void import("@ovule/shell-api")
          .then((api) => api.agent.respondApproval(id, false))
          .catch(() => {});
      }
      requests.clear();
      presentedAttempts.clear();
      emit();
    };
  }
  return { View, ModePicker: ApprovalModePicker, install };
}

export function ApprovalCard({
  id,
  request,
  t,
  respond,
}: {
  id: string;
  request: {
    attemptId: string;
    tool: string;
    arguments: unknown;
    automaticAllowed?: boolean;
    reviewFallback?: boolean;
  };
  t: TFunction;
  respond(id: string, allow: boolean, automatic?: boolean): Promise<void>;
}) {
  useEffect(() => {
    void import("@ovule/shell-api")
      .then((api) => api.agent.markApprovalPresented(id))
      .catch(() => {});
  }, [id]);
  const [automatic, setAutomatic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const answer = async (allow: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await respond(id, allow, allow && automatic);
    } catch {
      setError(true);
      setBusy(false);
    }
  };
  const argumentsObject =
    request.arguments && typeof request.arguments === "object"
      ? (request.arguments as Record<string, unknown>)
      : {};
  const operation = ["title", "command", "action"]
    .map((key) => argumentsObject[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const command =
    Array.isArray(argumentsObject.argv) &&
    argumentsObject.argv.every((value) => typeof value === "string")
      ? argumentsObject.argv.join(" ")
      : undefined;
  return (
    <Confirmation
      data-agent-approval={id}
      role="region"
      aria-label={t("agentApproval.title")}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          void answer(false);
        }
      }}
    >
      <Terminal size={18} aria-hidden="true" className={styles.icon} />
      <ConfirmationContent>
        <ConfirmationTitle>
          {command
            ? t("agentApproval.runCommand", { command: command.slice(0, 160) })
            : request.tool}
        </ConfirmationTitle>
        <ConfirmationDescription>
          {typeof argumentsObject.reason === "string"
            ? argumentsObject.reason.slice(0, 500)
            : operation
              ? operation.slice(0, 500)
              : t("agentApproval.description")}
        </ConfirmationDescription>
        {request.reviewFallback && (
          <p className={styles.attempt}>{t("agentApproval.reviewFallback")}</p>
        )}
        <details className={styles.details}>
          <summary>{t("agentApproval.details")}</summary>
          <p className={styles.attempt}>{request.attemptId}</p>
          <pre className={styles.preview}>{JSON.stringify(request.arguments, null, 2)}</pre>
        </details>
        {request.automaticAllowed !== false && (
          <label className={styles.automatic}>
            <Checkbox
              checked={automatic}
              disabled={busy}
              onChange={(event) => setAutomatic(event.currentTarget.checked)}
            />
            {t("agentApproval.automatic")}
          </label>
        )}
        {error && <p role="alert">{t("agentApproval.failed")}</p>}
      </ConfirmationContent>
      <ConfirmationActions>
        <ConfirmationAction variant="secondary" disabled={busy} onClick={() => void answer(false)}>
          {t("agentApproval.deny")}
        </ConfirmationAction>
        <ConfirmationAction
          variant="primary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void answer(true)}
        >
          {t(automatic ? "agentApproval.allowTask" : "agentApproval.allowOnce")}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}
