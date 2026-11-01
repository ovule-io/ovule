import { FileBreadcrumbs } from "./FileBreadcrumbs";
import browserTokens from "./browser.token";
import type { Register } from "@ovule/ioc";
import { lazy } from "react";
import { value } from "@ovule/ioc";
import { showExplorerTransferPreview, waitForExplorerPaint } from "./explorer-transfer";
export default function register(register: Register): void {
  registerRoute(register);
}

function registerRoute(register: Register): void {
  const NewTabPage = lazy(() =>
    import("./BrowserPanel").then((module) => ({ default: module.BrowserPanel })),
  );
  const ExplorerOverlay = lazy(() =>
    import("./ExplorerOverlay.tsx").then((module) => ({
      default: module.ExplorerOverlay,
    })),
  );
  register(
    browserTokens.routeRuntime,
    value({
      NewTabPage,
      ExplorerOverlay,
      FileBreadcrumbs,
      showExplorerTransferPreview,
      waitForExplorerPaint,
    }),
  );
}
