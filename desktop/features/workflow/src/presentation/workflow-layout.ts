import type { NodeView } from "@ovule/shell-api";

export function workflowColumns(nodes: NodeView[]): NodeView[][] {
  const visible = new Set(nodes.map((node) => node.id));
  const depths = new Map<string, number>();
  const columns: NodeView[][] = [];
  for (const node of nodes) {
    const dependencies = node.dependencyIds.filter((id) => visible.has(id));
    const depth = dependencies.length
      ? Math.max(...dependencies.map((id) => depths.get(id) ?? 0)) + 1
      : 0;
    depths.set(node.id, depth);
    (columns[depth] ??= []).push(node);
  }
  return columns;
}
