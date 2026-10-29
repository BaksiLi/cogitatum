import type { GraphNode, GraphProjection, PositionedNode } from "./projection.js";

export type Point2 = { x: number; y: number };
/**
 * A mark's drawn extent at full scale: the width of its wording and how far the wording reaches below
 * the mark's centre. A renderer that measures its type supplies this so wording never meets its neighbours.
 */
export type LabelExtent = { width: number; below: number };
export type LayoutOptions = { direction?: "down" | "right"; wrapWidth?: number; measure?: (node: GraphNode) => LabelExtent };

const sourceLine = (node: GraphNode) => node.sourceSpan?.startLine ?? Number.MAX_SAFE_INTEGER;
// Named junctions need a text column too; anonymous junctions only need glyph spacing.
const defaultFootprint = (node: GraphNode): number => node.ref.kind === "point" || node.name ? 168 : 64;
let footprint = defaultFootprint;
const GAP = 18;
/** How far a challenge sits to the right of what it contests: support stacks beneath, contest arrives from the side. */
const FLANK = 108;
const contests = (kind?: string) => kind === "challenges";

/**
 * Place each node in a row, keeping its order and the minimum spacing.
 * The node is pulled toward its wish. Averaging the left-packed and right-packed solutions keeps
 * every gap, because both satisfy it, and it does not drift to either side.
 */
function settle(row: GraphNode[], wish: Map<string, number>): Map<string, number> {
  const gap = (a: GraphNode, b: GraphNode) => (footprint(a) + footprint(b)) / 2 + GAP;
  const left: number[] = [], right: number[] = [];
  row.forEach((node, i) => { left[i] = i ? Math.max(wish.get(node.id)!, left[i - 1] + gap(row[i - 1], node)) : wish.get(node.id)!; });
  for (let i = row.length - 1; i >= 0; i--) right[i] = i < row.length - 1 ? Math.min(wish.get(row[i].id)!, right[i + 1] - gap(row[i], row[i + 1])) : wish.get(row[i].id)!;
  return new Map(row.map((node, i) => [node.id, (left[i] + right[i]) / 2]));
}

/**
 * The reading layout for any topology, usually the result of `projectExploration`.
 * Layered: what is borne upon sits above what bears on it.
 * A node shared by several Bearings sits among all of its targets, not only the first,
 * so no link has to run sideways across the Map.
 * Order within a layer follows the neighbours, then source order. Separate fragments wrap in rows.
 * Placement is a reading aid only: every link is still drawn, and nothing is inferred from position.
 */
export function layoutGraph(topology: GraphProjection, options: LayoutOptions = {}): PositionedNode[] {
  const { direction = "down", wrapWidth = 1100, measure } = options;
  const extent = new Map(measure ? topology.nodes.map(node => [node.id, measure(node)]) : []);
  footprint = measure ? (node: GraphNode) => Math.max(node.ref.kind === "point" ? 96 : 40, extent.get(node.id)!.width) : defaultFootprint;
  const ordered = [...topology.nodes].sort((a, b) => sourceLine(a) - sourceLine(b));
  const rank = new Map(ordered.map((node, i) => [node.id, i]));
  const byRank = (a: GraphNode, b: GraphNode) => rank.get(a.id)! - rank.get(b.id)!;

  // An acyclic reading: a link that closes a cycle, found in source order, does not constrain layers.
  const outgoing = new Map(ordered.map(node => [node.id, [] as string[]]));
  for (const link of topology.links) if (link.source !== link.target && rank.has(link.source) && rank.has(link.target)) outgoing.get(link.source)!.push(link.target);
  const targets = new Map(ordered.map(node => [node.id, new Set<string>()]));
  const sources = new Map(ordered.map(node => [node.id, new Set<string>()]));
  // A link arriving as a contest: an output segment (or a collapsed Bearing's single link) of a challenge.
  const contesting = new Set(topology.links.filter(link => link.segment === "output" && contests(link.kind)).map(link => `${link.source}>${link.target}`));
  const contest = (source: string, target: string) => contesting.has(`${source}>${target}`);
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const target of outgoing.get(id)!.sort((a, b) => rank.get(a)! - rank.get(b)!)) {
      if (state.get(target) === "open") continue;
      targets.get(id)!.add(target); sources.get(target)!.add(id);
      if (!state.has(target)) visit(target);
    }
    state.set(id, "done");
  };
  for (const node of ordered) if (!state.has(node.id)) visit(node.id);
  const layer = new Map<string, number>();
  const layerOf = (id: string): number => {
    if (!layer.has(id)) layer.set(id, Math.max(-1, ...[...targets.get(id)!].map(layerOf)) + 1);
    return layer.get(id)!;
  };

  // Fragments are laid out separately and keep the order in which they begin in the source.
  const fragment = new Map<string, string>();
  const rootOf = (id: string): string => { const up = fragment.get(id) ?? id; return up === id ? id : rootOf(up); };
  for (const [id, set] of targets) for (const target of set) { const a = rootOf(id), b = rootOf(target); if (a !== b) fragment.set(rank.get(a)! < rank.get(b)! ? b : a, rank.get(a)! < rank.get(b)! ? a : b); }
  const fragments = new Map<string, GraphNode[]>();
  for (const node of ordered) { const root = rootOf(node.id); fragments.set(root, [...fragments.get(root) ?? [], node]); }
  // A lone, unconnected Point waits after the connected argument instead of interrupting it.
  const ordering = [...fragments.values()].sort((a, b) => Number(a.length === 1) - Number(b.length === 1));

  const placed = new Map<string, Point2>();
  const mean = (ids: Iterable<string>, x: Map<string, number>) => { const xs = [...ids].map(id => x.get(id)!); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined; };
  // Downward: under what it bears on, shifted to the flank when it contests it.
  const below = (id: string, x: Map<string, number>) => {
    const xs = [...targets.get(id)!].map(target => x.get(target)! + (contest(id, target) ? FLANK : 0));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  };
  // Upward: over what supports it; a target is not pulled toward its challengers unless nothing else bears on it.
  const above = (id: string, x: Map<string, number>) => {
    const all = [...sources.get(id)!], carrying = all.filter(source => !contest(source, id));
    return carrying.length ? mean(carrying, x) : all.length ? mean(all, x)! - FLANK : undefined;
  };
  let cursorX = 0, cursorY = 0, rowHeight = 0, shelved = false;
  for (const nodes of ordering) {
    const layers: GraphNode[][] = [];
    for (const node of nodes) (layers[layerOf(node.id)] ??= []).push(node);
    const x = new Map<string, number>();
    // Downward: each node under the mean of what it bears on. Upward: each target over its sources.
    // The top layer keeps source order, so the reading begins where the text begins.
    layers.forEach((row, depth) => {
      const wish = new Map(row.map((node, i) => [node.id, depth ? below(node.id, x) ?? i * 200 : i * 200]));
      row.sort((a, b) => depth ? wish.get(a.id)! - wish.get(b.id)! || byRank(a, b) : byRank(a, b));
      settle(row, wish).forEach((value, id) => x.set(id, value));
    });
    for (let pass = 0; pass < 3; pass++) {
      for (let depth = layers.length - 2; depth >= 0; depth--) {
        const row = layers[depth];
        settle(row, new Map(row.map(node => [node.id, above(node.id, x) ?? x.get(node.id)!]))).forEach((value, id) => x.set(id, value));
      }
      for (let depth = 1; depth < layers.length; depth++) {
        const row = layers[depth];
        settle(row, new Map(row.map(node => [node.id, below(node.id, x) ?? x.get(node.id)!]))).forEach((value, id) => x.set(id, value));
      }
    }
    // Finish upward, so every target stands centred over what supports it.
    for (let depth = layers.length - 2; depth >= 0; depth--) {
      const row = layers[depth];
      settle(row, new Map(row.map(node => [node.id, above(node.id, x) ?? x.get(node.id)!]))).forEach((value, id) => x.set(id, value));
    }
    // Wording hangs below a point, up to three lines, so whatever comes next sits clear of it: a junction
    // just beneath the wording, a point further on. Below a layer of junctions alone the next sits closer.
    const ys: number[] = [];
    const hasPoint = (row: GraphNode[]) => row.some(node => node.ref.kind === "point");
    // With measured wording, the next layer starts below the deepest wording above it, plus room for its own mark.
    const step = (above: GraphNode[], row: GraphNode[]) => {
      const base = !hasPoint(above) ? 92 : hasPoint(row) ? 136 : 116;
      if (!measure) return base;
      const reach = Math.max(...above.map(node => extent.get(node.id)!.below));
      return Math.max(base, reach + (hasPoint(row) ? 52 : 34));
    };
    layers.forEach((row, depth) => { ys[depth] = depth ? ys[depth - 1] + step(layers[depth - 1], row) : 0; });
    const left = Math.min(...nodes.map(node => x.get(node.id)! - footprint(node) / 2));
    const w = Math.max(...nodes.map(node => x.get(node.id)! + footprint(node) / 2)) - left, h = ys[ys.length - 1];
    // Unconnected Points start their own shelf beneath the connected argument.
    const tray = nodes.length === 1 && !shelved && placed.size > 0;
    if (tray) shelved = true;
    if (cursorX > 0 && (tray || cursorX + w > wrapWidth)) { cursorX = 0; cursorY += rowHeight + 110; rowHeight = 0; }
    for (const node of nodes) placed.set(node.id, { x: cursorX + x.get(node.id)! - left, y: cursorY + ys[layer.get(node.id)!] });
    cursorX += w + 72; rowHeight = Math.max(rowHeight, h);
  }
  return topology.nodes.map(node => {
    const p = placed.get(node.id) ?? { x: 0, y: 0 };
    return { ...node, ...(direction === "right" ? { x: p.y * 1.7, y: p.x * .62 } : p) };
  });
}

export type RelaxOptions = { iterations?: number; pinned?: ReadonlySet<string>; strength?: number; direction?: "down" | "right" };

/**
 * A bounded, deterministic adjustment while dragging in the Map.
 * Pinned nodes do not move. Proximity is arrangement only; it never represents a Bearing.
 */
export function relaxLayout(topology: GraphProjection, positions: Map<string, Point2>, options: RelaxOptions = {}): Map<string, Point2> {
  const { iterations = 1, pinned = new Set<string>(), strength = 1, direction = "down" } = options;
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
      const axis = direction === "right" ? "x" : "y";
      if (b[axis] > a[axis] - 40) { ft[axis] -= 1.2; fs[axis] += 1.2; }
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
