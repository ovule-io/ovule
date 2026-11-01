import { expect, test } from "bun:test";
import { workflowColumns } from "./workflow-layout";
import type { NodeView } from "@ovule/shell-api";
test("lays dependency peers out as parallel Workflow branches", () => {
  const nodes = [
    { id: "inspect", dependencyIds: [] },
    { id: "provision", dependencyIds: ["inspect"] },
    { id: "pair-guide", dependencyIds: ["inspect"] },
    { id: "verify", dependencyIds: ["provision", "pair-guide"] },
  ] as NodeView[];
  expect(workflowColumns(nodes).map((column) => column.map((node) => node.id))).toEqual([
    ["inspect"],
    ["provision", "pair-guide"],
    ["verify"],
  ]);
});
