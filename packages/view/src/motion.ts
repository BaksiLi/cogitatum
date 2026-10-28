import { relaxLayout, type Point2 } from "./layout.js";
import type { GraphNode, GraphProjection } from "./projection.js";

const STEP = 1000 / 60, LIFETIME = 900, EPSILON = 1e-6;

/**
 * How far a drag reaches. `junctions`: only the junctions of the held mark's own Bearings
 * re-centre, so every other mark stays where the reader is inspecting it. `step`: those
 * Bearings' other endpoints follow too. Neither reaches past one step.
 */
export type DragReach = "junctions" | "step";

/** A short, damped simulation around the dragged mark. It owns no semantic state. */
export function createDragMotion(
  topology: GraphProjection, positions: Map<string, Point2>, dragged: string,
  pinned: ReadonlySet<string>, direction: "down" | "right" = "down", reach: DragReach = "junctions"
) {
  const adjacent = new Map(topology.nodes.map(n => [n.id, new Set<string>()]));
  for (const link of topology.links) {
    adjacent.get(link.source)?.add(link.target);
    adjacent.get(link.target)?.add(link.source);
  }
  const node = (id: string) => topology.nodes.find(n => n.id === id);
  const incident = new Set(node(dragged)?.ref.kind === "bearing" ? [dragged] : [...adjacent.get(dragged) ?? []].filter(id => node(id)?.ref.kind === "bearing"));
  const movable = new Set<string>(reach === "junctions" ? [...incident] : []);
  if (reach === "step") for (const id of incident) for (const next of [id, ...adjacent.get(id) ?? []]) movable.add(next);
  // A collapsed Bearing has no junction: its endpoints are adjacent directly.
  if (reach === "step" && node(dragged)?.ref.kind === "point") for (const next of adjacent.get(dragged) ?? []) movable.add(next);
  const free = topology.nodes.filter(n => movable.has(n.id) && n.id !== dragged && !pinned.has(n.id));
  // Only the moving neighbourhood and its fixed neighbours exert forces during a local drag.
  const active = new Set([dragged, ...free.map(node => node.id)]);
  for (const moving of free) for (const next of adjacent.get(moving.id) ?? []) active.add(next);
  const component = {
    nodes: topology.nodes.filter(node => active.has(node.id)),
    links: topology.links.filter(link => active.has(link.source) && active.has(link.target))
  };
  const moving = new Set(free.map(node => node.id));
  const fixed = new Set(component.nodes.filter(node => !moving.has(node.id)).map(node => node.id));
  const velocity = new Map(free.map(n => [n.id, { x: 0, y: 0 }]));
  let steppedAt: number | undefined, reheatedAt = 0, remainder = 0, quiet = 0;
  return {
    reheat(now: number) { reheatedAt = now; steppedAt ??= now; quiet = 0; },
    step(now: number): { active: boolean; moved: GraphNode[] } {
      const elapsed = Math.max(0, now - (steppedAt ?? reheatedAt)), age = Math.max(0, now - reheatedAt);
      steppedAt = now;
      const moved = new Set<GraphNode>();
      // Expiry follows wall time, including suspension and movement between animation frames.
      if (!free.length || age >= LIFETIME - EPSILON || quiet >= 5) return { active: false, moved: [] };
      // Fixed timesteps keep the feel independent of pointer frequency and 60/120 Hz displays.
      // A suspended tab never catches up with an unbounded burst of physics work.
      remainder += Math.min(elapsed, STEP * 3);
      while (remainder >= STEP - EPSILON) {
        remainder = Math.max(0, remainder - STEP);
        // Quantize cooling too, so floating-point frame boundaries do not change the trajectory.
        const stepAge = Math.max(0, Math.round((age - remainder) / STEP) * STEP);
        const cooled = Math.pow(Math.max(0, 1 - stepAge / LIFETIME), 2);
        const next = new Map(component.nodes.map(n => [n.id, { ...positions.get(n.id)! }]));
        relaxLayout(component, next, { pinned: fixed, direction, strength: cooled });
        let movement = 0;
        for (const node of free) {
          const p = positions.get(node.id)!, target = next.get(node.id)!, v = velocity.get(node.id)!;
          v.x = (v.x + (target.x - p.x) * .45) * .68;
          v.y = (v.y + (target.y - p.y) * .45) * .68;
          const x = p.x + v.x, y = p.y + v.y;
          if (x !== p.x || y !== p.y) { p.x = x; p.y = y; moved.add(node); }
          movement = Math.max(movement, Math.hypot(v.x, v.y));
        }
        quiet = movement < .025 ? quiet + 1 : 0;
        if (quiet >= 5) break;
      }
      return { active: quiet < 5, moved: [...moved] };
    }
  };
}
