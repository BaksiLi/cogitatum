import type { BearingTarget, GraphIR, SourceSpan } from "@cogitatum/core";
import { declarationMark } from "./marks.js";

export type GraphNode = {
  id: string;
  ref: BearingTarget;
  name?: string;
  label: string;
  text: string;
  sourceSpan?: SourceSpan;
};
export type GraphLink = { source: string; target: string; bearingKey: string; segment: "input" | "output" };
export type GraphProjection = { nodes: GraphNode[]; links: GraphLink[] };
export type PositionedNode = GraphNode & { x: number; y: number };
export const referenceKey = (ref: BearingTarget): string => `${ref.kind}:${ref.key}`;

/** Incidence projection: a Bearing stays an addressable node, including joint sources. */
export function projectGraph(graph: GraphIR): GraphProjection {
  const nodes: GraphNode[] = [
    ...graph.points.map(p => ({ id: referenceKey({ kind: "point", key: p.key }), ref: { kind: "point" as const, key: p.key },
      name: p.id, label: declarationMark(p.declaration).label,
      text: p.text, sourceSpan: p.sourceSpan })),
    ...graph.bearings.map(b => ({ id: referenceKey({ kind: "bearing", key: b.key }), ref: { kind: "bearing" as const, key: b.key },
      name: b.handle, label: b.kind, text: b.text ?? b.kind, sourceSpan: b.sourceSpan }))
  ];
  const ids = new Set(nodes.map(n => n.id));
  if (ids.size !== nodes.length) throw new Error("Graph has duplicate compilation keys.");
  const links: GraphLink[] = graph.bearings.flatMap(b => [
    ...b.sources.map(p => ({ source: referenceKey(p), target: referenceKey({ kind: "bearing", key: b.key }), bearingKey: b.key, segment: "input" as const })),
    { source: referenceKey({ kind: "bearing", key: b.key }), target: referenceKey(b.target), bearingKey: b.key, segment: "output" as const }
  ]);
  if (links.some(l => !ids.has(l.source) || !ids.has(l.target))) throw new Error("Graph contains a dangling reference.");
  return { nodes, links };
}

export type GraphFocus = { nodeIds: string[]; bearingKeys: string[] };

/** Reading assistance only: whole incident Bearings, with no transitive or inferential closure. */
export function focusNeighborhood(projection: GraphProjection, ref?: BearingTarget): GraphFocus {
  const id = ref && referenceKey(ref);
  if (!id || !projection.nodes.some(node => node.id === id)) return { nodeIds: [], bearingKeys: [] };
  const bearings = new Set(projection.links.filter(link => link.source === id || link.target === id).map(link => link.bearingKey));
  const related = new Set([id]);
  for (const link of projection.links) if (bearings.has(link.bearingKey)) { related.add(link.source); related.add(link.target); }
  return {
    nodeIds: projection.nodes.filter(node => related.has(node.id)).map(node => node.id),
    bearingKeys: projection.nodes.filter(node => node.ref.kind === "bearing" && bearings.has(node.ref.key)).map(node => node.ref.key)
  };
}

/** Visual topology only. A collapsed line still identifies exactly one compiled Bearing. */
export function projectExploration(projection: GraphProjection): GraphProjection & { inlineBearings: GraphNode[] } {
  const inputs = new Map<string, GraphLink[]>(), outputs = new Map<string, GraphLink>();
  const addressed = new Set<string>(), pairs = new Map<string, number>();
  for (const link of projection.links) {
    if (link.segment === "input") inputs.set(link.target, [...inputs.get(link.target) ?? [], link]);
    else { outputs.set(link.source, link); addressed.add(link.target); }
  }
  const pair = (node: GraphNode) => {
    const input = inputs.get(node.id), output = outputs.get(node.id);
    return input?.length === 1 && output ? [input[0].source, output.target].sort().join("\0") : undefined;
  };
  for (const node of projection.nodes.filter(node => node.ref.kind === "bearing")) {
    const key = pair(node); if (key) pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const inlineBearings = projection.nodes.filter(node => {
    if (node.ref.kind !== "bearing" || addressed.has(node.id)) return false;
    const input = inputs.get(node.id), output = outputs.get(node.id), key = pair(node);
    return input?.length === 1 && !!output && input[0].source !== output.target && !!key && pairs.get(key) === 1;
  });
  const collapsed = new Set(inlineBearings.map(node => node.id));
  return {
    nodes: projection.nodes.filter(node => !collapsed.has(node.id)),
    links: projection.links.flatMap(link => {
      if (link.segment === "input" && collapsed.has(link.target)) return [];
      if (link.segment === "output" && collapsed.has(link.source)) return [{ ...link, source: inputs.get(link.source)![0].source }];
      return [link];
    }),
    inlineBearings
  };
}
