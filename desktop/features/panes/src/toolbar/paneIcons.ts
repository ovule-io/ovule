import {
  AppWindow,
  FileSpreadsheet,
  FileText,
  Hand,
  MonitorUp,
  SquareTerminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { PaneKind } from "@ovule/panes/tab";

export const paneIcons: Record<PaneKind, LucideIcon> = {
  browser: AppWindow,
  handoff: Hand,
  spice: MonitorUp,
  files: FileText,
  office: FileSpreadsheet,
  markdown: FileText,
  terminal: SquareTerminal,
  workflow: Workflow,
};

export const addablePanes = (["browser", "files", "terminal", "workflow"] as const).map((kind) => ({
  kind,
  icon: paneIcons[kind],
  translationKey: kind === "files" ? "harness.localFiles" : `harness.${kind}`,
}));
