import type { ReactNode } from "react";
import type { ThreadView } from "@ovule/shell-api";
export interface RouteRuntime {
  ThreadSwitcherDialog: (arg0: {
    open: boolean;
    threads: ThreadView[];
    selectedThreadId?: string;
    onOpenChange(open: boolean): void;
    onSelectThread(id: string): void;
  }) => ReactNode;
}
