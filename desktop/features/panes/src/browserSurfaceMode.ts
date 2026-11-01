export function browserSurfaceMode(tab: {
  kind: string;
  target?: string;
  url?: string;
}): "pane" | "direct" {
  return tab.kind === "browser" && Boolean(tab.url || tab.target) ? "direct" : "pane";
}
