export type HostsViewState = {
  clearedLegacyLinkKey?: string;
  hiddenHostIdentityId?: string;
};

export interface HostsViewStateService {
  current(): HostsViewState;
  subscribe(listener: () => void): () => void;
  patch(value: Partial<HostsViewState>): void;
}
