import filesTokens from "@ovule/files/files.token";
import browserTokens from "@ovule/browser/browser.token";
import messagePartsTokens from "@ovule/message-parts/message-parts.token";
import remotingTokens from "@ovule/remoting/remoting.token";
import terminalTokens from "@ovule/terminal/terminal.token";
import workflowTokens from "@ovule/workflow/workflow.token";
import type { Registry } from "@ovule/ioc-container";
import registerPane from "@ovule/panes/pane.provider";
import registerWorkflow from "@ovule/workflow/pane.provider";
import registerBrowser from "@ovule/browser/pane.provider";
import registerFiles from "@ovule/files/files.provider";
import registerMessageParts from "@ovule/message-parts/pane.provider";
import registerRemoting from "@ovule/remoting/pane.provider";
import registerTerminal from "@ovule/terminal/pane.provider";

export function registerPaneDefinitions(registry: Registry): Registry {
  const register = registry.register.bind(registry);
  registerWorkflow(register);
  registerBrowser(register);
  registerFiles(register);
  registerMessageParts(register);
  registerRemoting(register);
  registerTerminal(register);

  registerPane(register, {
    definitions: (dependsOn) => [
      dependsOn(browserTokens.paneDefinition),
      dependsOn(filesTokens.fileEditorPaneDefinition),
      dependsOn(messagePartsTokens.paneDefinition),
      dependsOn(remotingTokens.paneDefinition),
      dependsOn(filesTokens.markdownPaneDefinition),
      dependsOn(filesTokens.localFilesPaneDefinition),
      dependsOn(terminalTokens.paneDefinition),
      dependsOn(workflowTokens.paneDefinition),
    ],
  });
  return registry;
}
