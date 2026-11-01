type ThreadSnapshot = { threads: Array<{ id: string }> };

export async function sendFirstMessage<TSnapshot extends ThreadSnapshot>({
  api,
  existingThreadIds,
  workspacePath,
  draftAgentId,
  draftHostId,
  send,
}: {
  api: {
    createThread(input: { workspacePath?: string }): Promise<TSnapshot>;
    selectAgent(threadId: string, agentId: string): Promise<TSnapshot>;
    selectHost(threadId: string, hostId: string): Promise<TSnapshot>;
  };
  existingThreadIds: ReadonlySet<string>;
  workspacePath?: string;
  draftAgentId?: string;
  draftHostId?: string;
  send(threadId: string): Promise<TSnapshot>;
}) {
  const created = await api.createThread({ workspacePath });
  const threadId = created.threads.find((thread) => !existingThreadIds.has(thread.id))?.id;
  if (!threadId) throw new Error("Created Thread was not returned");
  if (draftHostId && draftHostId !== "local") await api.selectHost(threadId, draftHostId);
  if (draftAgentId) await api.selectAgent(threadId, draftAgentId);
  const snapshot = await send(threadId);
  return { snapshot, threadId };
}
