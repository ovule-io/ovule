/** Native guests may retain a window-sized layout viewport. Bound the preview
 * root to the host's measured pane, independently of browser viewport units. */
export function applyPreviewViewport(width: unknown, height: unknown) {
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 16384;
  const root = document.getElementById("root");
  if (!root || !valid(width) || !valid(height)) return;
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
}
