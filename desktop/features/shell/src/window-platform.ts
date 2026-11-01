import { loadExternalModule } from "./load-external-module";
import { isNative } from "./native";
import type { WindowInfo, WindowOptions, WindowApi } from "./window";

let loading: Promise<WindowApi> | undefined;

export function windowApi(): Promise<WindowApi> {
  if (loading) return loading;
  if (!isNative) {
    return Promise.resolve({
      current: async () => ({
        id: 1n,
        maximized: false,
        minimized: false,
        fullscreen: false,
      }),
      create: async () => ({
        id: 2n,
        maximized: false,
        minimized: false,
        fullscreen: false,
      }),
      minimize: async () => ({
        id: 1n,
        maximized: false,
        minimized: true,
        fullscreen: false,
      }),
      maximize: async () => ({
        id: 1n,
        maximized: true,
        minimized: false,
        fullscreen: false,
      }),
      restore: async () => ({
        id: 1n,
        maximized: false,
        minimized: false,
        fullscreen: false,
      }),
      close: async () => undefined,
    });
  }
  loading = (async () => {
    return ((await loadExternalModule("/tuffite.js")) as { window: WindowApi }).window;
  })();
  return loading;
}

export async function openPopupWindow(url: string): Promise<WindowInfo> {
  const api = await windowApi();
  const width = Math.max(960, Math.min(1100, globalThis.screen?.availWidth - 80 || 1100));
  const height = Math.max(640, Math.min(760, globalThis.screen?.availHeight - 80 || 760));
  const x = Math.max(0, Math.round((globalThis.screen?.availWidth - width) / 2 || 0));
  const y = Math.max(0, Math.round((globalThis.screen?.availHeight - height) / 2 || 0));
  return api.create({ url, bounds: { x, y, width, height }, focused: true });
}

export const isMacOS =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
