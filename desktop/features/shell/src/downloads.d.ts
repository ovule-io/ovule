import type { ExplorerElement, ExplorerDownload } from "./explorer";
export type DownloadRecord = ExplorerDownload & {
  key: string;
  savedId?: string;
  savedPath?: string;
  createdAt: number;
  saveError?: string;
};
export type DownloadsState = { items: DownloadRecord[]; directory: string };
export interface DownloadsService {
  current(): DownloadsState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  update(element: ExplorerElement, item: ExplorerDownload): void;
  reveal(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  cancel(key: string): Promise<void>;
  pause(key: string): Promise<void>;
  resume(key: string): Promise<void>;
  setDirectory(path: string): Promise<void>;
}
