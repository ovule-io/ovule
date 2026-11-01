import type { HostView, RemoteEndpointView } from "@ovule/shell-api";
export type HostsStateServiceData = {
  revision: bigint;
  hosts: HostView[];
  endpoints: RemoteEndpointView[];
};
export interface HostsStateService {
  current(): {
    snapshot?: HostsStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface HostsStateController {
  service: HostsStateService;
  stage(state: ReturnType<HostsStateService["current"]>): void;
  patch(update: Partial<ReturnType<HostsStateService["current"]>>): void;
  notify(): void;
}
