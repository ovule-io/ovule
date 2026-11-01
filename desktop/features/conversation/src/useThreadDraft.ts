import shellTokens from "@ovule/shell/shell.token";
import { create, type ServiceOf } from "@ovule/ioc";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { WorkspaceOperation } from "@ovule/workspace/operations";
import type { ThreadView } from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";

export const useThreadDraftFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  return function useThreadDraft(
    thread: ThreadView | undefined,
    invoke: (operation: WorkspaceOperation) => Promise<boolean>,
    clearThread: () => void,
    chooseDirectory?: (title: string) => Promise<string | undefined>,
  ) {
    const { t } = useTranslation();
    const [workspacePath, setWorkspacePath] = useState("");
    const [choosingWorkspace, setChoosingWorkspace] = useState(false);
    const [interactionError, setInteractionError] = useState<string>();

    const chooseWorkspace = async () => {
      if (choosingWorkspace) return undefined;
      setChoosingWorkspace(true);
      setInteractionError(undefined);
      try {
        const title = t("sidebar.chooseFolder");
        const selected = chooseDirectory
          ? await chooseDirectory(title)
          : await (await shell.dialog()).openDirectory({ title });
        if (selected && thread) {
          if (await invoke((api) => api.setThreadWorkspace(thread.id, selected))) {
            setWorkspacePath("");
          }
        } else if (selected) {
          setWorkspacePath(selected);
        }
        return selected;
      } catch (error) {
        setInteractionError(error instanceof Error ? error.message : String(error));
        return undefined;
      } finally {
        setChoosingWorkspace(false);
      }
    };

    const clearWorkspace = () => setWorkspacePath("");
    const openNewThread = () => {
      clearThread();
      setWorkspacePath("");
    };

    return {
      workspacePath,
      setWorkspacePath,
      choosingWorkspace,
      interactionError,
      chooseWorkspace,
      clearWorkspace,
      openNewThread,
    };
  };
}, "useThreadDraft");

export const useThreadDraft = (...args: Parameters<ServiceOf<typeof useThreadDraftFactory>>) =>
  useService(useThreadDraftFactory)(...args);
