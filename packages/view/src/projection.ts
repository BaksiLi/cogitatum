import type { BearingKind, BearingTarget, GraphIR, Point, SourceSpan } from "@cogitatum/core";
import { FORMAT_VERSION } from "@cogitatum/core";
import { declarationMark } from "./marks.js";

export type GraphNode = {
  id: string;
  ref: BearingTarget;
  name?: string;
  label: string;
  text: string;
  sourceSpan?: SourceSpan;
  noteCount?: number;
};
/** `kind` is the Bearing's relation, so a renderer or layout can tell support from contest without a lookup. */
export type GraphLink = { source: string; target: string; bearingKey: string; segment: "input" | "output"; kind?: BearingKind };
export type GraphProjection = { nodes: GraphNode[]; links: GraphLink[] };
export type PositionedNode = GraphNode & { x: number; y: number };
export const referenceKey = (ref: BearingTarget): string => `${ref.kind}:${ref.key}`;

function requireCurrentGraph(graph: GraphIR): void {
  if (graph.version !== FORMAT_VERSION) throw new Error(`Unsupported graph format ${graph.version}; expected ${FORMAT_VERSION}. Recompile retained source.`);
}

/** Structural endings, never a judgment of whether the inquiry has been resolved. */
export function endingPoints(graph: GraphIR): Point[] {
  requireCurrentGraph(graph);
  const sources = new Set(graph.bearings.flatMap(bearing => bearing.sources.map(source => source.key)));
  const targets = new Set(graph.bearings.filter(bearing => bearing.target.kind === "point").map(bearing => bearing.target.key));
  return graph.points.filter(point => !sources.has(point.key) && targets.has(point.key))
    .sort((a, b) => (a.sourceSpan?.startLine ?? Infinity) - (b.sourceSpan?.startLine ?? Infinity));
}

/** Incidence projection: a Bearing stays an addressable node, including joint sources. */
export function projectGraph(graph: GraphIR): GraphProjection {
  requireCurrentGraph(graph);
  const nodes: GraphNode[] = [
    ...graph.points.map(p => ({ id: referenceKey({ kind: "point", key: p.key }), ref: { kind: "point" as const, key: p.key },
      name: p.id, label: declarationMark(p.declaration).label,
      text: p.text, sourceSpan: p.sourceSpan })),
    ...graph.bearings.map(b => ({ id: referenceKey({ kind: "bearing", key: b.key }), ref: { kind: "bearing" as const, key: b.key },
      name: b.handle, label: b.kind, text: b.text ?? b.kind, sourceSpan: b.sourceSpan }))
  ];
  const ids = new Set(nodes.map(n => n.id));
  if (ids.size !== nodes.length) throw new Error("Graph has duplicate compilation keys.");
  const noteCounts = new Map<string, number>();
  for (const note of graph.notes) {
    const id = referenceKey(note.target);
    if (!ids.has(id)) throw new Error("Graph contains a dangling note target.");
    if (note.origin === "note") noteCounts.set(id, (noteCounts.get(id) ?? 0) + 1);
  }
  for (const node of nodes) if (noteCounts.has(node.id)) node.noteCount = noteCounts.get(node.id);
  const links: GraphLink[] = graph.bearings.flatMap(b => [
    ...b.sources.map(p => ({ source: referenceKey(p), target: referenceKey({ kind: "bearing", key: b.key }), bearingKey: b.key, segment: "input" as const, kind: b.kind })),
    { source: referenceKey({ kind: "bearing", key: b.key }), target: referenceKey(b.target), bearingKey: b.key, segment: "output" as const, kind: b.kind }
  ]);
  if (links.some(l => !ids.has(l.source) || !ids.has(l.target))) throw new Error("Graph contains a dangling reference.");
  return { nodes, links };
}

export type GraphFocus = { nodeIds: string[]; bearingKeys: string[] };

/**
 * What guidance follows. A selection is what the reader is examining, so it keeps the emphasis;
 * pointer hover and keyboard focus preview a neighborhood only while no graph reference is selected.
 * Otherwise merely crossing the page with the pointer would move the emphasis off the chosen route.
 */
export function guidanceSubject<T extends { ref?: BearingTarget }>(selected?: T, previewed?: T): T | undefined {
  return selected?.ref ? selected : previewed ?? selected;
}

/** Whole incident Bearings; Point focus also includes their direct incoming relations. No transitive closure. */
export function focusNeighborhood(projection: GraphProjection, ref?: BearingTarget): GraphFocus {
  const id = ref && referenceKey(ref);
  if (!id || !projection.nodes.some(node => node.id === id)) return { nodeIds: [], bearingKeys: [] };
  const bearings = new Set(projection.links.filter(link => link.source === id || link.target === id).map(link => link.bearingKey));
  if (ref?.kind === "point") {
    // Take a snapshot: following a growing set would make depth depend on link order.
    const incidentIds = new Set([...bearings].map(key => referenceKey({ kind: "bearing", key })));
    for (const link of projection.links) {
      if (link.segment === "output" && incidentIds.has(link.target)) bearings.add(link.bearingKey);
    }
  }
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
