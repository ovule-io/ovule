import type { PaneKind } from "@ovule/panes/tab";

// Exhaustive against PaneKind so new panes cannot silently become browser searches.
const kinds: Record<PaneKind, true> = {
  workflow: true,
  browser: true,
  files: true,
  markdown: true,
  office: true,
  terminal: true,
  handoff: true,
  spice: true,
};
export function isWorkbenchKind(value: unknown): value is PaneKind {
  return typeof value === "string" && Object.hasOwn(kinds, value);
}
