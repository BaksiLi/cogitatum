import { relaxLayout, type Point2 } from "./layout.js";
import type { GraphNode, GraphProjection } from "./projection.js";

const STEP = 1000 / 60, LIFETIME = 900, EPSILON = 1e-6;

/** A short, damped simulation of the dragged component. It owns no semantic state. */
export function createDragMotion(
  topology: GraphProjection, positions: Map<string, Point2>, dragged: string,
  pinned: ReadonlySet<string>, direction: "down" | "right" = "down"
) {
  const adjacent = new Map(topology.nodes.map(n => [n.id, new Set<string>()]));
  for (const link of topology.links) {
    adjacent.get(link.source)?.add(link.target);
    adjacent.get(link.target)?.add(link.source);
  }
  const connected = new Set([dragged]);
  for (const id of connected) for (const next of adjacent.get(id) ?? []) connected.add(next);
  const component = {
    nodes: topology.nodes.filter(n => connected.has(n.id)),
    links: topology.links.filter(l => connected.has(l.source) && connected.has(l.target))
  };
  const free = component.nodes.filter(n => !pinned.has(n.id));
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
        relaxLayout(component, next, { pinned, direction, strength: cooled });
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
