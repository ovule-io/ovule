import type { PaneInstance } from "@ovule/panes/tab";

export const TAB_INDICATOR_LIMIT = 3;
export function recentTabs(tabs: readonly PaneInstance[]): PaneInstance[] {
  return [...tabs].sort((a, b) => (b.lastVisited ?? 0) - (a.lastVisited ?? 0));
}
