import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import type { HostPowerStatus } from "@ovule/shell-api";
import { Button } from "@ovule/ui/button";
import { Switch } from "@ovule/ui/form";
import { RefreshCw } from "lucide-react";

/** Local Host preference; its native request is owned by the application. */
export function HostPowerControl() {
  const workspace = useService(workspaceTokens.workspace);
  const { t } = useTranslation();
  const [status, setStatus] = useState<HostPowerStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const id = useId();
  const version = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    const load = async () => {
      if (saving.current) return;
      const request = ++version.current;
      try {
        const value = await workspace.api().then((api) => api.hostPowerStatus());
        if (version.current === request) {
          setStatus(value);
          setError(value.error ?? undefined);
        }
      } catch (cause) {
        if (version.current === request) setError(String(cause));
      }
    };
    void load();
    window.addEventListener("focus", load);
    return () => {
      ++version.current;
      window.removeEventListener("focus", load);
    };
  }, [workspace, refresh]);

  const update = async (enabled: boolean) => {
    if (saving.current) return;
    const request = ++version.current;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const value = await workspace.api().then((api) => api.setHostKeepAwake(enabled));
      if (version.current === request) {
        setStatus(value);
        setError(value.error ?? undefined);
      }
    } catch (cause) {
      if (version.current === request) setError(String(cause));
    } finally {
      saving.current = false;
      if (version.current === request) setBusy(false);
    }
  };

  return (
    <section
      className="grid gap-2 rounded-lg border border-(--line) bg-(--surface) p-3"
      data-host-power-control
    >
      <label className="flex items-start justify-between gap-4">
        <span className="grid gap-1">
          <strong className="font-medium">{t("hosts.keepAwake")}</strong>
          <span className="text-(length:--font-size-caption) text-(--muted-foreground)">
            {t("hosts.keepAwakeDescription")}
          </span>
        </span>
        <Switch
          aria-label={t("hosts.keepAwake")}
          aria-describedby={`${id}-status ${id}-limitations`}
          className="mt-0.5 shrink-0"
          checked={status?.keepAwake ?? false}
          disabled={!status?.supported || busy}
          onChange={(event) => void update(event.currentTarget.checked)}
        />
      </label>
      <p
        id={`${id}-status`}
        role="status"
        className="text-(length:--font-size-caption) text-(--muted-foreground)"
      >
        {busy
          ? t("hosts.keepAwakeSaving")
          : !status
            ? t("hosts.keepAwakeLoading")
            : !status.supported
              ? t("hosts.keepAwakeUnsupported")
              : status.active
                ? t("hosts.keepAwakeActive")
                : status.keepAwake
                  ? t("hosts.keepAwakeInactive")
                  : t("hosts.keepAwakeOff")}
      </p>
      <p
        id={`${id}-limitations`}
        className="text-(length:--font-size-caption) text-(--muted-foreground)"
      >
        {t("hosts.keepAwakeLimitations")}
      </p>
      {error && (
        <p role="alert" className="break-words text-(length:--font-size-caption) text-(--danger)">
          {t("hosts.keepAwakeFailed")} {error}
        </p>
      )}
      {((status?.keepAwake && !status.active && status.supported) || (!status && error)) && (
        <Button
          variant="secondary"
          size="sm"
          className="justify-self-start"
          disabled={busy}
          onClick={() => (status ? void update(true) : setRefresh((value) => value + 1))}
        >
          <RefreshCw size={14} />
          {t("hosts.keepAwakeRetry")}
        </Button>
      )}
    </section>
  );
}
