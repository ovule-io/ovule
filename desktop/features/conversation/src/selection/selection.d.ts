type SelectionCandidates = {
  threads: { id: string }[];
  goals: { id: string }[];
};

export type SelectionState = {
  selectedThreadId?: string;
  selectedGoalId?: string;
};

export interface SelectionService {
  current(): SelectionState;
  subscribe(listener: () => void): () => void;
  selectThread(id: string): void;
  clearThread(): void;
  selectGoal(id: string): void;
  acceptSnapshot(snapshot: SelectionCandidates, fallback: "first" | "last"): void;
}
