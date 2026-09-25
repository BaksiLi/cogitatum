import type { BearingTarget, GraphIR, SourceSpan } from "@cogitatum/core";

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
      name: p.id, label: p.form === "gap" ? "Gap" : p.form === "material" ? "Material" : `${p.role}${p.status === "open" ? "?" : ""}`,
      text: p.text, sourceSpan: p.sourceSpan })),
    ...graph.bearings.map(b => ({ id: referenceKey({ kind: "bearing", key: b.key }), ref: { kind: "bearing" as const, key: b.key },
      name: b.handle, label: b.kind, text: b.text ?? `${b.kind} · ${b.derivedBy}`, sourceSpan: b.sourceSpan }))
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

export function layoutGraph(projection: GraphProjection, direction: "down" | "right" = "down"): PositionedNode[] {
  const ranks = new Map(projection.nodes.map(n => [n.id, 0]));
  const degrees = new Map(projection.nodes.map(n => [n.id, 0]));
  const outgoing = new Map(projection.nodes.map(n => [n.id, [] as string[]]));
  for (const link of projection.links) {
    degrees.set(link.target, degrees.get(link.target)! + 1);
    outgoing.get(link.source)!.push(link.target);
  }
  const queue = projection.nodes.filter(n => degrees.get(n.id) === 0).map(n => n.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const target of outgoing.get(id)!) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(id)! + 1));
      degrees.set(target, degrees.get(target)! - 1);
      if (degrees.get(target) === 0) queue.push(target);
    }
  }
  // Cycles are allowed by the language. Lay out their remaining nodes without inventing an ordering claim.
  let cyclic = 0;
  for (const node of projection.nodes) if (degrees.get(node.id)! > 0) ranks.set(node.id, cyclic++ % 3);
  const rows = new Map<number, number>();
  return projection.nodes.map(node => {
    const rank = ranks.get(node.id)!;
    const row = rows.get(rank) ?? 0;
    rows.set(rank, row + 1);
    return { ...node, x: 130 + (direction === "down" ? row : rank) * 270, y: 80 + (direction === "down" ? rank : row) * 140 };
  });
}
