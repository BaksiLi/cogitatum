import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { projectExploration, projectGraph } from "./projection.js";
import { layoutGraph } from "./layout.js";
import { createDragMotion } from "./motion.js";

function setup() {
  const graph = compileSource('- [C] Claim.\n  - [linked]\n    - [G] First.\n    - [G] Second.\n- [C] Separate.\n', 'document').graphs[0];
  const topology = projectExploration(projectGraph(graph));
  const positions = new Map(layoutGraph(topology).map(n => [n.id, { x: n.x, y: n.y }]));
  const dragged = topology.nodes.find(n => n.text === 'First.')!.id;
  const claim = topology.nodes.find(n => n.text === 'Claim.')!.id;
  const separate = topology.nodes.find(n => n.text === 'Separate.')!.id;
  positions.get(dragged)!.x += 160;
  return { topology, positions, dragged, claim, separate };
}

describe('drag settling', () => {
  it('pulls through a joint, keeps held nodes and other fragments fixed, then stops', () => {
    const { topology, positions, dragged, claim, separate } = setup();
    const before = structuredClone(positions), original = structuredClone(topology);
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    expect(motion.step(100)).toBe(true);
    expect(positions.get(claim)).not.toEqual(before.get(claim));
    for (let i = 0; i < 65; i++) motion.step(1000 / 60);
    expect(motion.step(1000 / 60)).toBe(false);
    expect(positions.get(dragged)).toEqual(before.get(dragged));
    expect(positions.get(separate)).toEqual(before.get(separate));
    expect(topology).toEqual(original);
    const settled = structuredClone(positions);
    motion.step(1000);
    expect(positions).toEqual(settled);
  });

  it('respects earlier placements and produces the same movement at 60 and 120 Hz', () => {
    const a = setup(), b = setup();
    const pinned = new Set([a.dragged, a.claim]);
    const claim = { ...a.positions.get(a.claim)! };
    const one = createDragMotion(a.topology, a.positions, a.dragged, pinned);
    const two = createDragMotion(b.topology, b.positions, b.dragged, pinned);
    for (let i = 0; i < 60; i++) one.step(1000 / 60);
    for (let i = 0; i < 120; i++) two.step(1000 / 120);
    expect(a.positions).toEqual(b.positions);
    expect(a.positions.get(a.claim)).toEqual(claim);
  });
});
