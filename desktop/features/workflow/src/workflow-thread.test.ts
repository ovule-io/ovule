import { expect, test } from "bun:test";
test("keeps Workflow authoring Agent-driven", async () => {
  const panel = await Bun.file(new URL("./WorkflowPanel.tsx", import.meta.url)).text();
  const goalDraft = await Bun.file(new URL("./useGoalDraft.ts", import.meta.url)).text();
  expect(panel).not.toContain("api.addTask");
  expect(panel).not.toContain("api.addGate");
  expect(panel).toContain("workflow.adjustHint");
  expect(goalDraft).toContain("api.sendMessage(thread.id, `/goal ${goalPrompt.trim()}`)");
});
