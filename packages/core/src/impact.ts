import type { Edge, Graph, ImpactPathStep, ImpactResult } from "./model.js";

function step(edge: Edge): ImpactPathStep {
  return { from: edge.from, to: edge.to, kind: edge.kind, line: edge.line, confidence: edge.confidence };
}

function traverse(graph: Graph, nodeId: string, direction: "forward" | "reverse"): ImpactResult[] {
  if (!graph.nodes.has(nodeId)) return [];
  const adjacency = direction === "reverse" ? graph.reverse : graph.forward;
  const visited = new Set([nodeId]);
  const results: ImpactResult[] = [];
  let frontier: Array<{ id: string; path: ImpactPathStep[] }> = [{ id: nodeId, path: [] }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const current of frontier) {
      for (const edge of adjacency.get(current.id) ?? []) {
        const neighbor = direction === "reverse" ? edge.from : edge.to;
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        const path = [...current.path, step(edge)];
        results.push({ nodeId: neighbor, depth: path.length, path, confidence: path.some((part) => part.confidence === "possible") ? "possible" : "certain" });
        next.push({ id: neighbor, path });
      }
    }
    frontier = next;
  }
  return results;
}

/** Files that depend on the selected node, traversing reverse edges. */
export function getImpact(graph: Graph, nodeId: string): ImpactResult[] { return traverse(graph, nodeId, "reverse"); }
/** Files and modules used by the selected node, traversing forward edges. */
export function getDependencies(graph: Graph, nodeId: string): ImpactResult[] { return traverse(graph, nodeId, "forward"); }
