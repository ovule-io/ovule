export type IsolatedRequest = { method: string; params: unknown; signal: AbortSignal };
export interface IsolatedView {
  update(properties: Record<string, unknown>): Promise<void>;
  dispose(): Promise<void>;
}
export type MountIsolated = (
  container: HTMLElement,
  extensionId: string,
  tag: string,
  properties: Record<string, unknown>,
  onRequest?: (request: IsolatedRequest) => unknown | Promise<unknown>,
) => Promise<IsolatedView>;
