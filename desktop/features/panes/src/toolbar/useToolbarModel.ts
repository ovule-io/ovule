import conversationTokens from "@ovule/conversation/conversation.token";
import shellTokens from "@ovule/shell/shell.token";
import { useService } from "@ovule/ioc/react";
import { usePaneToolbar } from "./usePaneToolbar";
import type { ToolbarViewProps } from "./view";

export function useToolbarModel(props: ToolbarViewProps, placement: "thread" | "workbench") {
  const state = usePaneToolbar(props.active);
  const selection = useService(conversationTokens.selection);
  const { copyText } = useService(shellTokens.shell);
  const { active, tabs, threadId, draftId } = props;
  const selectTab = (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    if (tab?.placement === "thread" && tab.threadId) selection.selectThread(tab.threadId);
    state.explorer.selectTab(id);
  };
  const dismiss = () => {
    state.setAddOpen(false);
    state.setListOpen(false);
    state.setEditing(false);
  };
  return {
    ...state,
    ...props,
    placement,
    selectTab,
    dismiss,
    addTab: () => {
      dismiss();
      state.explorer.openTab("browser", { threadId, draftId, newInstance: true, placement });
    },
    closeActive: () => active && state.explorer.closeTab(active.id),
    startEditing: () => {
      state.setAddress(active?.url ?? active?.target ?? "");
      state.setEditing(true);
      state.setListOpen(false);
    },
    startSearch: () => {
      state.setAddress("");
      state.setEditing(true);
    },
    copyAddress: () => {
      const value = active?.url ?? active?.target;
      return value ? copyText(value) : false;
    },
  };
}
export type ToolbarModel = ReturnType<typeof useToolbarModel>;
