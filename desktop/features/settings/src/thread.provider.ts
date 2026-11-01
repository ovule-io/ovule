import workspaceTokens from "@ovule/workspace/workspace.token";
import settingsTokens from "./settings.token";
import type { Register } from "@ovule/ioc";
export default function register(register: Register): void {
  registerExtensionCatalog(register);
}

function registerExtensionCatalog(register: Register): void {
  register(settingsTokens.extensionCatalog, async (dependsOn) =>
    (await dependsOn(workspaceTokens.workspace).api()).extensionCatalog(),
  );
}
