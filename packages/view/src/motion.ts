import { relaxLayout, type Point2 } from "./layout.js";
import type { GraphProjection } from "./projection.js";

const STEP = 1000 / 60, LIFETIME = 900;

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
  let age = 0, remainder = 0, quiet = 0;
  return {
    reheat() { age = 0; quiet = 0; },
    step(elapsed: number): boolean {
      if (!free.length || age >= LIFETIME) return false;
      // Fixed timesteps keep the feel independent of pointer frequency and 60/120 Hz displays.
      // A suspended tab never catches up with an unbounded burst of physics work.
      remainder += Math.max(0, Math.min(elapsed, STEP * 3));
      while (remainder >= STEP && age < LIFETIME) {
        remainder -= STEP; age += STEP;
        const cooled = Math.pow(Math.max(0, 1 - age / LIFETIME), 2);
        const next = new Map(component.nodes.map(n => [n.id, { ...positions.get(n.id)! }]));
        relaxLayout(component, next, { pinned, direction, strength: cooled });
        let movement = 0;
        for (const node of free) {
          const p = positions.get(node.id)!, target = next.get(node.id)!, v = velocity.get(node.id)!;
          v.x = (v.x + (target.x - p.x) * .45) * .68;
          v.y = (v.y + (target.y - p.y) * .45) * .68;
          p.x += v.x; p.y += v.y;
          movement = Math.max(movement, Math.hypot(v.x, v.y));
        }
        quiet = movement < .025 ? quiet + 1 : 0;
        if (quiet >= 5) { age = LIFETIME; return false; }
      }
      return age < LIFETIME;
    }
  };
}
