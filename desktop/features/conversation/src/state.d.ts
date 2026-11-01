import type { ThreadView, ThreadMessageView } from "@ovule/shell-api";
export type ConversationStateServiceData = {
  revision: bigint;
  threads: ThreadView[];
  messages: ThreadMessageView[];
};
export interface ConversationStateService {
  current(): {
    snapshot?: ConversationStateServiceData;
    pending: number;
    busy: boolean;
    error?: string;
  };
  subscribe(listener: () => void): () => void;
}

/** Composition control for coherent, staged snapshot publication. */
export interface ConversationStateController {
  service: ConversationStateService;
  stage(state: ReturnType<ConversationStateService["current"]>): void;
  patch(update: Partial<ReturnType<ConversationStateService["current"]>>): void;
  notify(): void;
}
