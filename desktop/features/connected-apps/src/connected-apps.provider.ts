import connectedAppsViewTokens from "./connected-apps.token";
import type { Register } from "@ovule/ioc";
import { ConnectedAppsSectionFactory } from "./ConnectedAppsSection.tsx";

export default function register(register: Register): void {
  register(connectedAppsViewTokens.connectedAppsView, (dependsOn) =>
    dependsOn(ConnectedAppsSectionFactory),
  );
}
