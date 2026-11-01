import type { WindowApi } from "@ovule/shell/window";

export const WINDOW_MIN_WIDTH = 576;
export const CONTENT_MIN_WIDTH = 568;
export const WORKBENCH_MIN_WIDTH = 320;
export const WORKBENCH_DEFAULT_WIDTH = 360;
export const WORKBENCH_SEPARATOR_WIDTH = 4;
export const WORKBENCH_WINDOW_MIN_WIDTH =
  WINDOW_MIN_WIDTH + WORKBENCH_MIN_WIDTH + WORKBENCH_SEPARATOR_WIDTH;

// Size changes follow the current panel width, including separator drags.
export function createWorkbenchWindow() {
  return async (api: WindowApi, open: boolean, panelWidth: number, _screen?: Screen) => {
    const current = await api.current();
    await api.setConstraints?.({
      minWidth: open ? WORKBENCH_WINDOW_MIN_WIDTH : WINDOW_MIN_WIDTH,
      minHeight: 640,
    });
    if (!api.setBounds || !current.bounds || current.maximized || current.fullscreen) return;
    const bounds = current.bounds;
    if (open) {
      const width = bounds.width + panelWidth + WORKBENCH_SEPARATOR_WIDTH;
      await api.setBounds({ ...bounds, width });
    } else {
      await api.setBounds({
        ...bounds,
        width: Math.max(WINDOW_MIN_WIDTH, bounds.width - panelWidth - WORKBENCH_SEPARATOR_WIDTH),
      });
    }
  };
}
