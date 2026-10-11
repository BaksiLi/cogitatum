import type { GraphNode, GraphProjection, PositionedNode } from "./projection.js";

export type Point2 = { x: number; y: number };
export type FlowOptions = { direction?: "down" | "right"; wrapWidth?: number };

const sourceLine = (node: GraphNode) => node.sourceSpan?.startLine ?? Number.MAX_SAFE_INTEGER;
const footprint = (node: GraphNode) => node.ref.kind === "point" ? 168 : 64;
const GAP = 18;

/**
 * Reading layout for any topology (usually `projectExploration`). What is borne upon sits above
 * what bears on it; each node hangs below its first target in source order (a placement choice only;
 * every link is still drawn). Siblings keep source order; separate trees are wrapped in rows.
 */
export function layoutFlow(topology: GraphProjection, options: FlowOptions = {}): PositionedNode[] {
  const { direction = "down", wrapWidth = 1100 } = options;
  const byId = new Map(topology.nodes.map(node => [node.id, node]));
  const parent = new Map<string, string>();
  const ancestorOf = (a: string, id: string) => { for (let c: string | undefined = id, n = 0; c && n < 999; c = parent.get(c), n++) if (c === a) return true; return false; };
  const ordered = [...topology.nodes].sort((a, b) => sourceLine(a) - sourceLine(b));
  for (const node of ordered) {
    const out = topology.links.filter(l => l.source === node.id && l.target !== node.id && byId.has(l.target));
    const target = out.find(l => !ancestorOf(node.id, l.target))?.target;
    if (target) parent.set(node.id, target);
  }
  const children = new Map(topology.nodes.map(node => [node.id, [] as GraphNode[]]));
  for (const node of ordered) { const p = parent.get(node.id); if (p) children.get(p)!.push(node); }
  const width = new Map<string, number>();
  const measure = (node: GraphNode): number => {
    const kids = children.get(node.id)!;
    const w = kids.length ? Math.max(footprint(node), kids.reduce((sum, kid, i) => sum + measure(kid) + (i ? GAP : 0), 0)) : footprint(node);
    width.set(node.id, w); return w;
  };
  const step = (a: GraphNode, b: GraphNode) => a.ref.kind === "point" && b.ref.kind === "point" ? 118 : 76;
  const placed = new Map<string, Point2>();
  const place = (node: GraphNode, left: number, y: number): number => {
    const kids = children.get(node.id)!;
    let x = left + width.get(node.id)! / 2;
    if (kids.length) {
      const span = kids.reduce((sum, kid, i) => sum + width.get(kid.id)! + (i ? GAP : 0), 0);
      let at = left + (width.get(node.id)! - span) / 2;
      const xs = kids.map(kid => { const cx = place(kid, at, y + step(node, kid)); at += width.get(kid.id)! + GAP; return cx; });
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    placed.set(node.id, { x, y });
    return x;
  };
  const depth = (node: GraphNode): number => Math.max(0, ...children.get(node.id)!.map(kid => step(node, kid) + depth(kid)));
  let cursorX = 0, cursorY = 0, rowHeight = 0;
  for (const root of ordered.filter(node => !parent.has(node.id))) {
    const w = measure(root), h = depth(root);
    if (cursorX > 0 && cursorX + w > wrapWidth) { cursorX = 0; cursorY += rowHeight + 110; rowHeight = 0; }
    place(root, cursorX, cursorY);
    cursorX += w + 72; rowHeight = Math.max(rowHeight, h);
  }
  return topology.nodes.map(node => {
    const p = placed.get(node.id) ?? { x: 0, y: 0 };
    return { ...node, ...(direction === "right" ? { x: p.y * 1.7, y: p.x * .62 } : p) };
  });
}

export type RelaxOptions = { iterations?: number; pinned?: ReadonlySet<string>; strength?: number };

/**
 * A bounded, deterministic force pass shared by the settled graph layout and live dragging.
 * Pinned nodes do not move. Proximity is arrangement only; it never represents a Bearing.
 */
export function relaxLayout(topology: GraphProjection, positions: Map<string, Point2>, options: RelaxOptions = {}): Map<string, Point2> {
  const { iterations = 1, pinned = new Set<string>(), strength = 1 } = options;
  const nodes = topology.nodes.filter(node => positions.has(node.id));
  const radius = (node: GraphNode) => node.ref.kind === "point" ? 62 : 24;
  const links = topology.links.filter(link => link.source !== link.target && positions.has(link.source) && positions.has(link.target));
  for (let step = 0; step < iterations; step++) {
    const force = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = positions.get(nodes[i].id)!, b = positions.get(nodes[j].id)!;
      let dx = b.x - a.x, dy = b.y - a.y;
      if (!dx && !dy) { dx = (j - i) * .7; dy = .3; }
      const d = Math.max(1, Math.hypot(dx, dy)), min = radius(nodes[i]) + radius(nodes[j]);
      const push = Math.min(14, 9000 / (d * d)) + (d < min ? (min - d) * .5 : 0);
      const fa = force.get(nodes[i].id)!, fb = force.get(nodes[j].id)!;
      fa.x -= dx / d * push; fa.y -= dy / d * push; fb.x += dx / d * push; fb.y += dy / d * push;
    }
    for (const link of links) {
      const a = positions.get(link.source)!, b = positions.get(link.target)!;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
      const pull = (d - (link.segment === "input" ? 92 : 150)) * .06;
      const fs = force.get(link.source)!, ft = force.get(link.target)!;
      fs.x += dx / d * pull; fs.y += dy / d * pull; ft.x -= dx / d * pull; ft.y -= dy / d * pull;
      // Gentle reading bias: what is borne upon tends to sit above what bears on it.
      if (b.y > a.y - 40) { ft.y -= 1.2; fs.y += 1.2; }
    }
    for (const node of nodes) {
      if (pinned.has(node.id)) continue;
      const p = positions.get(node.id)!, f = force.get(node.id)!;
      p.x += Math.max(-18, Math.min(18, f.x)) * strength;
      p.y += Math.max(-18, Math.min(18, f.y)) * strength;
    }
  }
  return positions;
}

/** The settled exploration arrangement: starts from the reading layout, then relaxes. */
export function layoutGraphSettled(topology: GraphProjection, seed: PositionedNode[] = layoutFlow(topology)): PositionedNode[] {
  const positions = new Map(seed.map(node => [node.id, { x: node.x, y: node.y }]));
  relaxLayout(topology, positions, { iterations: 140, strength: .9 });
  return topology.nodes.map(node => ({ ...node, ...(positions.get(node.id) ?? { x: 0, y: 0 }) }));
}
