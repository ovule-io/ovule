import { useEffect, useRef, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import type { TFunction } from "i18next";
import styles from "./agent-approvals.module.css";
import { InputGroupButton } from "@ovule/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@ovule/ui/overlays";

/** Session-wide preference is owned by the host, never localStorage or model input. */
export function ApprovalModePicker({ translate: t }: { translate: TFunction }) {
  const revision = useRef(0);
  const [mode, setMode] = useState("ask");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      const observed = revision.current;
      try {
        const { agent } = await import("@ovule/shell-api");
        const current = await agent.approvalMode();
        if (active && observed === revision.current) {
          setMode(current);
          setReady(true);
        }
      } catch {
        if (active && observed === revision.current) setReady(false);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const change = async (next: string) => {
    revision.current++;
    setBusy(true);
    setError(false);
    try {
      const { agent } = await import("@ovule/shell-api");
      if (!(await agent.setApprovalMode(next))) throw new Error("Approval mode rejected");
      setMode(next);
    } catch {
      setError(true);
    } finally {
      revision.current++;
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          className={styles.modeTrigger}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("agentApproval.mode")}
          disabled={!ready || busy}
          title={t(error ? "agentApproval.modeError" : "agentApproval.modeDescription")}
        >
          <ShieldCheck size={14} />
          {t(mode === "review" ? "agentApproval.reviewMode" : "agentApproval.askMode")}
          <ChevronDown size={12} />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        <p className={styles.modeDescription}>{t("agentApproval.modeDescription")}</p>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => void change(value)}>
          <DropdownMenuRadioItem value="ask" disabled={busy}>
            {t("agentApproval.askMode")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="review" disabled={busy}>
            {t("agentApproval.reviewMode")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {error && <p role="alert">{t("agentApproval.modeError")}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
