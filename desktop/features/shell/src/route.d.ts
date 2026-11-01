import type { WindowInfo, WindowApi } from "./window";
import type { ExplorerOpenRequest } from "./explorer";
import type { ComponentType } from "react";
export interface RouteRuntime {
  DownloadsButton: ComponentType<{ className?: string; side?: "left" | "right" | "bottom" }>;
  openPopupWindow: (arg0: string) => Promise<WindowInfo>;
  windowApi: () => Promise<WindowApi>;
  explorerOpenDestination: (
    arg0: string,
    arg1: Pick<ExplorerOpenRequest, "url"> & Partial<Pick<ExplorerOpenRequest, "userGesture">>,
  ) => "ignore" | "current" | "popup" | "overlay";
}
