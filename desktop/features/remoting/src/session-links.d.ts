export type SpiceSessionRequest = {
  endpointId: string;
  displayName: string;
  websocketUrl: string;
};
export type LinkRemoteControlSessionRequest = {
  endpointId: string;
  displayName: string;
};
export interface SessionLinksService {
  encodeSpiceSession(request: SpiceSessionRequest): string;
  encodeLinkRemoteControlSession(request: LinkRemoteControlSessionRequest): string;
}
