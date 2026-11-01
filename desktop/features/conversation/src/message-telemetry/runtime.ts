export type MessageTelemetryRuntime = {
  surface: string;
  documentUrl: string;
  language: string;
  timezone: string;
  online: boolean;
  visibility: DocumentVisibilityState;
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
};

export function captureMessageTelemetryRuntime(
  surface = "thread-explorer",
): MessageTelemetryRuntime {
  return {
    surface,
    documentUrl: location.href,
    language: document.documentElement.lang || navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    visibility: document.visibilityState,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
  };
}
