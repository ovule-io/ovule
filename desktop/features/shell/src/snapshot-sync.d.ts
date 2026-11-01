import type { AppSnapshot } from "@ovule/shell-api";
import type { WorkspaceApi, AgentOutputEvent } from "@ovule/workspace/contract";
/** Wire operations are interpreted by desktop composition, never a global state store. */
export type WorkspaceOperation = (api: WorkspaceApi) => Promise<AppSnapshot>;
export interface SnapshotSyncService {
  load(): Promise<void>;
  invoke(operation: WorkspaceOperation): Promise<boolean>;
  acceptSnapshot(snapshot: AppSnapshot): void;
  appendAgentOutput(event: AgentOutputEvent): void;
}
