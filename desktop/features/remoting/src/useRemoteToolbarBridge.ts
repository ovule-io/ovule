import shellTokens from "@ovule/shell/shell.token";
import { useService } from "@ovule/ioc/react";
import { useEffect } from "react";
import {
  handleRemoteToolbarCommand,
  type RemoteToolbarHandlers,
  type RemoteToolbarState,
} from "./remote-toolbar";

export function useRemoteToolbarBridge(
  tabId: string,
  state: RemoteToolbarState,
  handlers: RemoteToolbarHandlers,
) {
  const shell = useService(shellTokens.shell);
  const serialized = JSON.stringify(state);
  useEffect(() => {
    void shell
      .requestRoot("tab.metadata", { tabId, toolbarState: JSON.parse(serialized) })
      .catch(console.error);
  }, [shell, tabId, serialized]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string; action?: string }>).detail;
      if (detail?.tabId && detail.tabId !== tabId) return;
      if (typeof detail?.action === "string") handleRemoteToolbarCommand(detail.action, handlers);
    };
    window.addEventListener("ovule:pane-command", receive);
    return () => window.removeEventListener("ovule:pane-command", receive);
  }, [tabId, handlers]);
}
