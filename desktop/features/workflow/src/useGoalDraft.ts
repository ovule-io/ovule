import { useState } from "react";

import type { WorkspaceOperation } from "./operations";
import type { ThreadView } from "@ovule/shell-api";

export function useGoalDraft(
  thread: ThreadView | undefined,
  invoke: (operation: WorkspaceOperation) => Promise<boolean>,
) {
  const [newGoal, setNewGoal] = useState(false);
  const [goalPrompt, setGoalPrompt] = useState("");
  const [creatingGoal, setCreatingGoal] = useState(false);
  const prepareGoal = async () => {
    if (thread) setNewGoal(true);
  };
  const createGoal = async () => {
    if (!thread || !goalPrompt.trim() || creatingGoal) return;
    setCreatingGoal(true);
    try {
      if (await invoke((api) => api.sendMessage(thread.id, `/goal ${goalPrompt.trim()}`))) {
        setGoalPrompt("");
        setNewGoal(false);
      }
    } finally {
      setCreatingGoal(false);
    }
  };
  return {
    newGoal,
    setNewGoal,
    goalPrompt,
    setGoalPrompt,
    creatingGoal,
    prepareGoal,
    createGoal,
  };
}
