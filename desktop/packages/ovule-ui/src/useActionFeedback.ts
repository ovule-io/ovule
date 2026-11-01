import { useEffect, useRef, useState } from "react";

export type ActionFeedbackStatus = "idle" | "pending" | "success" | "error";
export function useActionFeedback() {
  const [status, setStatus] = useState<ActionFeedbackStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const run = async (action: () => boolean | void | null | Promise<boolean | void | null>) => {
    clearTimeout(timer.current);
    setStatus("pending");
    let ok = false;
    try {
      const outcome = await action();
      if (outcome === null) {
        if (active.current) setStatus("idle");
        return false;
      }
      ok = outcome !== false;
    } catch {
      ok = false;
    }
    if (active.current) {
      setStatus(ok ? "success" : "error");
      timer.current = setTimeout(() => setStatus("idle"), 2200);
    }
    return ok;
  };
  return { status, run };
}
