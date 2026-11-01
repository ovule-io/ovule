import panesTokens from "@ovule/panes/panes.token";
import frameworkTokens from "./framework.token";
import { create, type ServiceOf } from "@ovule/ioc";
import { useService } from "@ovule/ioc/react";
import { useObservableState } from "@ovule/ioc/react";

export const useFrameworkLayoutFactory = create((dependsOn) => {
  const service = dependsOn(frameworkTokens.frameworkLayout);
  const explorerService = dependsOn(panesTokens.panes);
  return function useFrameworkLayout() {
    const hasPaneInstances = useObservableState(
      explorerService,
      (state) => state.instances.length > 0,
    );
    const state = useObservableState(service, (state) => ({
      workbenchOpen: state.workbenchOpen,
      sidebarWidth: state.sidebarWidth,
      workbenchWidth: state.workbenchWidth,
    }));
    return {
      ...state,
      hasPaneInstances,
      setSidebarWidth: service.setSidebarWidth,
      setWorkbenchWidth: service.setWorkbenchWidth,
    };
  };
}, "useFrameworkLayout");

export const useFrameworkLayout = (
  ...args: Parameters<ServiceOf<typeof useFrameworkLayoutFactory>>
) => useService(useFrameworkLayoutFactory)(...args);
