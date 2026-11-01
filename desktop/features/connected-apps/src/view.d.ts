import type { ViewData } from "./view-data";
import type { ComponentType } from "react";

import type { WorkspaceOperation } from "./operations";

export type ConnectedAppsViewProps = {
  snapshot: ViewData;
  busy: boolean;
  invoke(operation: WorkspaceOperation): Promise<boolean>;
};

export type ConnectedAppsViewTokenValue = ComponentType<ConnectedAppsViewProps>;
