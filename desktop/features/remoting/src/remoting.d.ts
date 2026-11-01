import type { ControlApi, ControlUpdate } from "./model";

export interface RemoteControlService {
  api(): Promise<ControlApi>;
  observe(listener: (update: ControlUpdate) => void): () => void;
}
