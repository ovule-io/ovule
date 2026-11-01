import { create } from "zustand";

import type { SelectionService, SelectionState } from "./selection";
type SelectionCandidates = {
  threads: { id: string }[];
  goals: { id: string }[];
};

type SelectionStoreState = SelectionState & {
  selectThread(id: string): void;
  clearThread(): void;
  selectGoal(id: string): void;
  acceptSnapshot(snapshot: SelectionCandidates, fallback: "first" | "last"): void;
};

export function createSelectionService(): SelectionService {
  const store = create<SelectionStoreState>((set) => ({
    selectThread: (selectedThreadId) => set({ selectedThreadId }),
    clearThread: () => set({ selectedThreadId: "", selectedGoalId: undefined }),
    selectGoal: (selectedGoalId) => set({ selectedGoalId }),
    acceptSnapshot: (snapshot, fallback) =>
      set((state) => ({
        selectedThreadId:
          state.selectedThreadId !== undefined &&
          (state.selectedThreadId === "" ||
            snapshot.threads.some((thread) => thread.id === state.selectedThreadId))
            ? state.selectedThreadId
            : fallback === "last"
              ? snapshot.threads.at(-1)?.id
              : snapshot.threads[0]?.id,
        selectedGoalId:
          state.selectedGoalId && snapshot.goals.some((goal) => goal.id === state.selectedGoalId)
            ? state.selectedGoalId
            : fallback === "last"
              ? snapshot.goals.at(-1)?.id
              : snapshot.goals[0]?.id,
      })),
  }));
  return {
    current: store.getState,
    subscribe: (listener) => store.subscribe(listener),
    selectThread: (id) => store.getState().selectThread(id),
    clearThread: () => store.getState().clearThread(),
    selectGoal: (id) => store.getState().selectGoal(id),
    acceptSnapshot: (snapshot, fallback) => store.getState().acceptSnapshot(snapshot, fallback),
  };
}
