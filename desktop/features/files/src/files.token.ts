import { createToken, tokens } from "@ovule/ioc";
import type { PaneDefinition } from "@ovule/panes/pane";
export default tokens({
  markdownPaneDefinition: createToken<PaneDefinition>("markdownPaneDefinition"),
  localFilesPaneDefinition: createToken<PaneDefinition>("localFilesPaneDefinition"),
  fileEditorPaneDefinition: createToken<PaneDefinition>("fileEditorPaneDefinition"),
});
