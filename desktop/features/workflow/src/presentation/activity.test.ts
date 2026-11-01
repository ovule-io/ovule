import { expect, test } from "bun:test";
import type { AttemptView, NodeView, ThreadMessageView } from "@ovule/shell-api";
import { workflowActivityFor, workflowSetupThread } from "./ActiveWorkflowCard";

test("pending Workflows expose queued workers and planners without counting another Goal", () => {
  const nodes = [
    { id: "ours", goalId: "goal", threadId: "step" },
    { id: "theirs", goalId: "other" },
  ] as NodeView[];
  const attempts = [
    { id: "queued", taskId: "ours", status: "queued" },
    { id: "done", taskId: "ours", status: "succeeded" },
    { id: "elsewhere", taskId: "theirs", status: "running" },
  ] as AttemptView[];
  const planners = [
    { id: "planner", purpose: "workflow_replan:goal:ours", status: "running" },
    {
      id: "other-planner",
      purpose: "goal_adjustment:other",
      status: "running",
    },
  ] as AttemptView[];
  expect(
    workflowActivityFor("goal", nodes, attempts, planners).map((attempt) => attempt.id),
  ).toEqual(["planner", "queued"]);
  expect(workflowActivityFor("goal", nodes, [{ ...attempts[0], status: "succeeded" }], [])).toEqual(
    [],
  );
});

test("the parent configuration shortcut follows its persisted Node, not another materialized Thread", () => {
  const nodes = [
    { id: "setup", goalId: "goal", threadId: "setup-thread" },
    { id: "verify", goalId: "goal", threadId: "verify-thread" },
  ] as NodeView[];
  const messages = [
    {
      parts: [
        { kind: "workflow", dataJson: "invalid" },
        {
          kind: "workflow",
          dataJson: JSON.stringify({ goalId: "goal", setupNodeId: "setup" }),
        },
      ],
    },
  ] as ThreadMessageView[];
  expect(workflowSetupThread("goal", nodes, messages)).toBe("setup-thread");
  expect(workflowSetupThread("other", nodes, messages)).toBeUndefined();
  expect(workflowSetupThread("goal", [{ ...nodes[0], threadId: "" }], messages)).toBeUndefined();
});
