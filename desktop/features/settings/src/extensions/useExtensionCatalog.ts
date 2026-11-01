import workspaceTokens from "@ovule/workspace/workspace.token";
import { create } from "@ovule/ioc";
import { useCallback, useEffect, useState } from "react";
import { useService } from "@ovule/ioc/react";
import type { ExtensionCatalogView } from "@ovule/shell-api";

export const ExtensionCatalogHookFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  return function useExtensionCatalog() {
    const [catalog, setCatalog] = useState<ExtensionCatalogView>();
    const [error, setError] = useState<string>();
    const refresh = useCallback(async () => {
      try {
        setCatalog(await (await workspace.api()).extensionCatalog());
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, [workspace]);
    useEffect(() => {
      void refresh();
    }, [refresh]);
    return { catalog, error, refresh };
  };
}, "useExtensionCatalog");
export const useExtensionCatalog = () => useService(ExtensionCatalogHookFactory)();
