/** No native calls or real approvals are issued by the transcript fixture. */
export const agent = {
  pendingApprovals: async (attemptId: string) =>
    (
      (
        globalThis as typeof globalThis & {
          approvalPending?: Array<{ requestId: string; attemptId: string; arguments: unknown }>;
        }
      ).approvalPending ?? []
    )
      .filter((item) => item.attemptId === attemptId)
      .map((item) => ({
        ...item,
        tool: "fixture.tool",
        argumentsJson: JSON.stringify(item.arguments),
        automaticAllowed: false,
        expiresAtMs: BigInt(Date.now() + 120000),
      })),
  markApprovalPresented: async () => true,
  respondApproval: async () => true,
  respondApprovalWithScope: async () => true,
};
