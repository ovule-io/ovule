// Native Explorer contracts are owned by the Tuffite SDK. These aliases keep
// the application's existing public names without duplicating native models.
import type {
  HTMLExplorerElement,
  ExplorerOpenDetail as ExplorerOpenRequest,
  ExplorerDialogController as ExplorerDialog,
} from "tuffite/explorer";
export type {
  ExplorerHandle as ExplorerTransfer,
  ExplorerNavigationState,
  ExplorerOpenDetail as ExplorerOpenRequest,
  ExplorerDialogController as ExplorerDialog,
  ExplorerDownload,
} from "tuffite/explorer";

export type ExplorerElement = HTMLExplorerElement & EventTarget;

export type TuffiteMessageEvent = MessageEvent<unknown>;

export interface TuffiteMessageApi {
  postMessage(data: unknown, options?: WindowPostMessageOptions): void;
  addEventListener(name: "message", listener: (event: TuffiteMessageEvent) => void): void;
  removeEventListener(name: "message", listener: (event: TuffiteMessageEvent) => void): void;
  addEventListener(
    name: "open" | "popup" | "newwindow" | "navigation",
    listener: (event: CustomEvent<ExplorerOpenRequest>) => void,
  ): void;
  addEventListener(name: "dialog", listener: (event: CustomEvent<ExplorerDialog>) => void): void;
}

export type BrowserAgentMetadata = {
  attemptId: string;
  partition: string;
  userControl: boolean;
  generation?: number;
};
export interface BrowserAgentBinding {
  readonly attemptId: string;
  readonly partition: string;
  readonly ready: Promise<void>;
  status(): "agent" | "user" | "moving" | "closed";
  subscribe(listener: () => void): () => void;
  toggleControl(): void;
  bind(element: ExplorerElement, closeSurface: () => void): () => void;
  activate(element: ExplorerElement): void;
  beginTransfer(): Promise<void>;
  finishTransfer(): void;
  prepareWindow(): {
    port: MessagePort;
    metadata: BrowserAgentMetadata;
    commit(): void;
    cancel(): void;
  };
  call(args: Record<string, unknown>): Promise<unknown>;
  close(): void;
}
