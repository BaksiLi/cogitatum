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
  const rowCounts = new Map<number, number>();
  for (const rank of ranks.values()) rowCounts.set(rank, (rowCounts.get(rank) ?? 0) + 1);
  const widest = Math.max(0, ...rowCounts.values());
  const rows = new Map<number, number>();
  return projection.nodes.map(node => {
    const rank = ranks.get(node.id)!;
    const row = rows.get(rank) ?? 0;
    rows.set(rank, row + 1);
    const centered = row + (widest - rowCounts.get(rank)!) / 2;
    return { ...node, x: 130 + (direction === "down" ? centered : rank) * 270, y: 80 + (direction === "down" ? rank * 112 : centered * 140) };
  });
}

/** A settled exploration layout. Geometry expresses proximity, never a new Bearing. */
export function layoutConstellation(projection: GraphProjection): PositionedNode[] {
  const count = projection.nodes.length;
  const positioned = projection.nodes.map((node, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = 110 * Math.sqrt(index);
    return { ...node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const indices = new Map(positioned.map((node, index) => [node.id, index]));
  const halfWidth = (_index: number) => 50;
  const halfHeight = (index: number) => positioned[index].ref.kind === "point" ? 58 : 44;
  // Run a bounded simulation before painting: no timer, jitter, or simulation to clean up.
  for (let step = 0; step < 160; step++) {
    const forces = positioned.map(node => ({ x: -node.x * .002, y: -node.y * .002 }));
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = positioned[i], b = positioned[j];
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const repel = Math.min(12, 16000 / (distance * distance));
      const fx = dx / distance * repel, fy = dy / distance * repel;
      forces[i].x -= fx; forces[i].y -= fy; forces[j].x += fx; forces[j].y += fy;
    }
    for (const link of projection.links) {
      const i = indices.get(link.source)!, j = indices.get(link.target)!;
      if (i === j) continue;
      const dx = positioned[j].x - positioned[i].x, dy = positioned[j].y - positioned[i].y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 165) * .035;
      const fx = dx / distance * force, fy = dy / distance * force;
      forces[i].x += fx; forces[i].y += fy; forces[j].x -= fx; forces[j].y -= fy;
    }
    const cooling = 1 - step / 200;
    positioned.forEach((node, index) => {
      node.x += Math.max(-16, Math.min(16, forces[index].x)) * cooling;
      node.y += Math.max(-16, Math.min(16, forces[index].y)) * cooling;
    });
    // Resolve card collisions separately so the settled result remains readable.
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = positioned[i], b = positioned[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const overlapX = halfWidth(i) + halfWidth(j) + 24 - Math.abs(dx);
      const overlapY = halfHeight(i) + halfHeight(j) + 24 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      if (overlapX < overlapY) {
        const shift = (dx < 0 ? -1 : 1) * overlapX / 2;
        a.x -= shift; b.x += shift;
      } else {
        const shift = (dy < 0 ? -1 : 1) * overlapY / 2;
        a.y -= shift; b.y += shift;
      }
    }
  }
  const minX = Math.min(0, ...positioned.map(node => node.x - 90));
  const minY = Math.min(0, ...positioned.map(node => node.y - 80));
  return positioned.map(node => ({ ...node, x: node.x - minX, y: node.y - minY }));
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
