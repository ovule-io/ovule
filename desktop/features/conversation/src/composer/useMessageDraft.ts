import composerTokens from "../conversation.token";
import type { ViewData } from "./view-data";
import { create, type ServiceOf } from "@ovule/ioc";
import { useLayoutEffect, useState } from "react";

import type { ComposerAttachment } from "./composer";
import type { WorkspaceOperation } from "./operations";
import type { ThreadView } from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";
import { useObservableState } from "@ovule/ioc/react";
import { sendFirstMessage } from "./firstMessage";

export type MessageImageDraft = ComposerAttachment;

type UseMessageDraftDependencies = {
  composer: ServiceOf<typeof composerTokens.composer>;
};

function useMessageDraftImpl(
  dependencies: UseMessageDraftDependencies,
  snapshot: ViewData | undefined,
  thread: ThreadView | undefined,
  invoke: (operation: WorkspaceOperation) => Promise<boolean>,
  selectThread: (id: string) => void,
  workspacePath: string,
  draftAgentId?: string,
  draftHostId?: string,
  clearDraftAgent?: () => void,
  onDraftCommitted?: (threadId: string) => Promise<void>,
) {
  const { composer } = dependencies;
  const contextId = thread?.id ?? "";
  useLayoutEffect(() => composer.selectContext(contextId), [composer, contextId]);

  const { messageText, messageImages, attachmentError } = useObservableState(composer, (state) => ({
    messageText: state.text,
    messageImages: state.attachments,
    attachmentError: state.attachmentError,
  }));
  const [sendingMessage, setSendingMessage] = useState(false);

  const sendMessage = async () => {
    if (!snapshot || (!messageText.trim() && !messageImages.length) || sendingMessage) return;
    const content = messageText.trim();
    const attachments = messageImages.map(({ name, mediaType, bytes }) => ({
      name,
      mediaType,
      bytes,
    }));
    const send = (api: Parameters<WorkspaceOperation>[0], threadId: string) =>
      attachments.length
        ? api.sendMessageWithAttachments(threadId, content, attachments)
        : api.sendMessage(threadId, content);
    setSendingMessage(true);
    try {
      if (thread) {
        if (await invoke((api) => send(api, thread.id))) {
          composer.clear(contextId);
        }
        return;
      }
      let id: string | undefined;
      const succeeded = await invoke(async (api) => {
        const existing = new Set(snapshot.threads.map((item) => item.id));
        const result = await sendFirstMessage({
          api,
          existingThreadIds: existing,
          workspacePath: workspacePath.trim() || undefined,
          draftAgentId,
          draftHostId,
          send: (threadId) => send(api, threadId),
        });
        id = result.threadId;
        return result.snapshot;
      });
      if (succeeded && id) {
        await onDraftCommitted?.(id);
        selectThread(id);
        clearDraftAgent?.();
        composer.clear(contextId);
      }
    } finally {
      setSendingMessage(false);
    }
  };
  return {
    messageText,
    setMessageText: composer.setText,
    messageImages,
    attachmentError,
    addPastedImages: composer.addImages,
    removeMessageImage: composer.removeAttachment,
    sendingMessage,
    sendMessage,
  };
}

export const useMessageDraftFactory = create((dependsOn) => {
  const composer = dependsOn(composerTokens.composer);
  return useMessageDraftImpl.bind(undefined, { composer });
}, "useMessageDraft");

export const useMessageDraft = (...args: Parameters<ServiceOf<typeof useMessageDraftFactory>>) =>
  useService(useMessageDraftFactory)(...args);
