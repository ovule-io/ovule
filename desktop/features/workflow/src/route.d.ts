import type { WorkspaceOperation } from "./operations";
import type { ThreadView } from "@ovule/shell-api";
export interface RouteRuntime {
  useGoalDraft: (
    arg0: ThreadView | undefined,
    arg1: (operation: WorkspaceOperation) => Promise<boolean>,
  ) => GoalDraft;
}
export type GoalDraft = {
  newGoal: boolean;
  setNewGoal(value: boolean): void;
  goalPrompt: string;
  setGoalPrompt(value: string): void;
  creatingGoal: boolean;
  prepareGoal(): Promise<void>;
  createGoal(): Promise<void>;
};
