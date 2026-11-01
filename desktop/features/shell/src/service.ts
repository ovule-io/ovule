import { installAgentBrowserControls, receiveBrowserAgent } from "./browser-agent";
import { installBrowserControl } from "./browser-control";
import { createAgentApprovals } from "./agent-approvals";
import { installDesktopControlFeedback } from "./desktop-control-feedback";
import { installExplorerResources } from "./explorer-resources";
import { copyText } from "./clipboard";
import { workspaceCandidatePath, workspaceRelativePath } from "./dialog-platform";
import { explorerOpenDestination, resolveBrowserTarget } from "./explorer-navigation";
import { surfaceUrl, navigateSurface } from "./routes";
import { openPopupWindow } from "./window-platform";
import { mountIsolated } from "./isolated";
import { loadExternalModule } from "./load-external-module";
import { dialogApi } from "./dialog-platform";
import type { DialogApi } from "./dialog";
import { tuffiteMessageApi, requestRoot } from "./explorer-platform";
import type { TuffiteMessageApi } from "./explorer";
import { isNative } from "./native";
import { isMacOS, windowApi } from "./window-platform";
import type { WindowApi } from "./window";
import type { ShellService } from "./shell";
import { downloadHistory } from "./downloads-service";
import {
  htmlPreviewSource,
  localExplorerAddress,
  fileCodeLanguage,
  listLocalDirectory,
  readLocalText,
  readLocalFile,
  revealLocalFile,
} from "./local-files";

import { loadExplorer } from "./preview-loader";

const agentApprovals = createAgentApprovals();

export const defaultShellService: ShellService = {
  loadExplorer,
  htmlPreviewSource,
  localExplorerAddress,
  fileCodeLanguage,
  listLocalDirectory,
  readLocalText,
  readLocalFile,
  revealLocalFile,
  downloads: downloadHistory,
  installExplorerResources,
  installBrowserControl,
  installAgentApprovals: agentApprovals.install,
  agentApprovals,
  installAgentBrowserControls,
  receiveBrowserAgent,
  installDesktopControlFeedback,
  copyText,
  workspaceCandidatePath,
  workspaceRelativePath,
  explorerOpenDestination,
  resolveBrowserTarget: (value) =>
    resolveBrowserTarget(
      value,
      typeof localStorage === "undefined"
        ? undefined
        : (localStorage.getItem("ovule.search.url") ?? undefined),
    ),
  surfaceUrl,
  navigateSurface,
  openPopupWindow,
  windowApi,
  loadExternalModule,
  mountIsolated,
  native: isNative,
  macOS: isMacOS,
  dialog: dialogApi,
  window: windowApi,
  messageApi: tuffiteMessageApi,
  requestRoot,
};
