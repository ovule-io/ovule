import { createToken, tokens } from "@ovule/ioc";
import type { PaneDefinition } from "@ovule/panes/pane";
import type { WorkflowPresentation } from "./presentation/workflow-presentation";
import type { RouteRuntime } from "./route";
import type { WorkflowStateService, WorkflowStateController } from "./state";

export default tokens({
  paneDefinition: createToken<PaneDefinition>("workflowPaneDefinition"),
  presentation: createToken<WorkflowPresentation>("WorkflowPresentation"),
  routeRuntime: createToken<RouteRuntime>("workflowRouteRuntime"),
  stateController: createToken<WorkflowStateController>("WorkflowStateController"),
  workflowState: createToken<WorkflowStateService>("WorkflowStateService"),
});
