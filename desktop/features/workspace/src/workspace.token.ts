import { createToken, tokens } from "@ovule/ioc";
import type { WorkspaceStateService, WorkspaceStateController } from "./state";
import type { WorkspaceService } from "./workspace";

export default tokens({
  stateController: createToken<WorkspaceStateController>("WorkspaceStateController"),
  workspaceState: createToken<WorkspaceStateService>("WorkspaceStateService"),
  workspace: createToken<WorkspaceService>("WorkspaceService"),
});
