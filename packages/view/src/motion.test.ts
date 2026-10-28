import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { projectExploration, projectGraph } from "./projection.js";
import { layoutGraph } from "./layout.js";
import { createDragMotion } from "./motion.js";

function setup() {
  const graph = compileSource("- [C] Claim.\n  - [_ G]\n    - [.] First.\n    - [.] Second.\n- [C] Separate.\n", 'document').graphs[0];
  const topology = projectExploration(projectGraph(graph));
  const positions = new Map(layoutGraph(topology).map(n => [n.id, { x: n.x, y: n.y }]));
  const dragged = topology.nodes.find(n => n.text === 'First.')!.id;
  const claim = topology.nodes.find(n => n.text === 'Claim.')!.id;
  const separate = topology.nodes.find(n => n.text === 'Separate.')!.id;
  positions.get(dragged)!.x += 160;
  return { topology, positions, dragged, claim, separate };
}

describe('drag settling', () => {
  it('moves only the held mark\'s junction by default, so every other Point stays put', () => {
    const { topology, positions, dragged, claim, separate } = setup();
    const before = structuredClone(positions);
    const junction = topology.nodes.find(node => node.ref.kind === 'bearing')!.id;
    const second = topology.nodes.find(node => node.text === 'Second.')!.id;
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    for (let i = 1; i <= 60; i++) motion.step(i * 1000 / 60);
    expect(positions.get(junction)).not.toEqual(before.get(junction));
    for (const id of [claim, second, separate]) expect(positions.get(id)).toEqual(before.get(id));
  });

  it('pulls the step\'s other endpoints with Shift, keeps held nodes and other fragments fixed, then stops', () => {
    const { topology, positions, dragged, claim, separate } = setup();
    const before = structuredClone(positions), original = structuredClone(topology);
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]), 'down', 'step');
    const first = motion.step(100);
    expect(first.active).toBe(true);
    expect(first.moved).toContainEqual(topology.nodes.find(node => node.id === claim));
    expect(first.moved.some(node => node.id === dragged || node.id === separate)).toBe(false);
    expect(positions.get(claim)).not.toEqual(before.get(claim));
    for (let i = 1; i <= 65; i++) motion.step(100 + i * 1000 / 60);
    expect(motion.step(1200).active).toBe(false);
    expect(positions.get(dragged)).toEqual(before.get(dragged));
    expect(positions.get(separate)).toEqual(before.get(separate));
    expect(topology).toEqual(original);
    const settled = structuredClone(positions);
    expect(motion.step(2000).moved).toEqual([]);
    expect(positions).toEqual(settled);
  });

  it('respects earlier placements and produces the same movement at 60 and 120 Hz', () => {
    const a = setup(), b = setup();
    const pinned = new Set([a.dragged, a.claim]);
    const claim = { ...a.positions.get(a.claim)! };
    const one = createDragMotion(a.topology, a.positions, a.dragged, pinned, 'down', 'step');
    const two = createDragMotion(b.topology, b.positions, b.dragged, pinned, 'down', 'step');
    for (let i = 1; i <= 60; i++) one.step(i * 1000 / 60);
    for (let i = 1; i <= 120; i++) two.step(i * 1000 / 120);
    expect(a.positions).toEqual(b.positions);
    expect(a.positions.get(a.claim)).toEqual(claim);
  });

  it('expires after 900 ms of wall time even when frames arrive at 10 Hz', () => {
    const { topology, positions, dragged } = setup();
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    for (let i = 1; i <= 8; i++) expect(motion.step(i * 100).active).toBe(true);
    expect(motion.step(900).active).toBe(false);
    const settled = structuredClone(positions);
    motion.step(1000);
    expect(positions).toEqual(settled);
  });

  it('expires across a suspended frame without applying stale physics', () => {
    const { topology, positions, dragged } = setup();
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    const before = structuredClone(positions);
    expect(motion.step(1000).active).toBe(false);
    expect(positions).toEqual(before);
  });

  it('starts the deadline at the last pointer movement between frames', () => {
    const { topology, positions, dragged } = setup();
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    motion.reheat(5000);
    expect(motion.step(5100).active).toBe(true);
    motion.reheat(5150);
    expect(motion.step(6000).active).toBe(true);
    expect(motion.step(6050).active).toBe(false);
  });

  it('bounds catch-up work before the wall-time deadline', () => {
    const { topology, positions, dragged } = setup();
    positions.get(dragged)!.x += 10000;
    const before = structuredClone(positions);
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    expect(motion.step(800).active).toBe(true);
    for (const [id, point] of positions) {
      expect(Math.abs(point.x - before.get(id)!.x)).toBeLessThan(54);
      expect(Math.abs(point.y - before.get(id)!.y)).toBeLessThan(54);
    }
  });

  it('keeps cooling bounded when pointer movement reheats just before a delayed frame', () => {
    const { topology, positions, dragged } = setup();
    positions.get(dragged)!.x += 10000;
    const before = structuredClone(positions);
    const motion = createDragMotion(topology, positions, dragged, new Set([dragged]));
    motion.reheat(0);
    motion.reheat(999);
    expect(motion.step(1000).active).toBe(true);
    // At full strength the three damped catch-up steps displace at most 27 px per axis.
    for (const [id, point] of positions) {
      expect(Math.abs(point.x - before.get(id)!.x)).toBeLessThan(27);
      expect(Math.abs(point.y - before.get(id)!.y)).toBeLessThan(27);
    }
  });

  it('excludes remote branches from the forces on a local junction', () => {
    const graph = compileSource('- [C] Top.\n  - [_ G]\n    - [.] First.\n    - [.] Second.\n      - [G @remote] Remote.\n        - [G @distant] Distant.', 'document').graphs[0];
    const topology = projectGraph(graph);
    const remote = new Set(topology.nodes.filter(node => ['remote', 'distant'].includes(node.name ?? '')).map(node => node.id));
    for (const link of topology.links) if (link.segment === 'input' && remote.has(link.source)) remote.add(link.target);
    const local = { nodes: topology.nodes.filter(node => !remote.has(node.id)), links: topology.links.filter(link => !remote.has(link.source) && !remote.has(link.target)) };
    const positions = new Map(layoutGraph(topology).map(node => [node.id, { x: node.x, y: node.y }]));
    const dragged = topology.nodes.find(node => node.text === 'First.')!.id;
    positions.get(dragged)!.x += 100;
    const second = structuredClone(positions);
    const one = createDragMotion(topology, positions, dragged, new Set([dragged]));
    const two = createDragMotion(local, second, dragged, new Set([dragged]));
    for (let i = 1; i <= 60; i++) { one.step(i * 1000 / 60); two.step(i * 1000 / 60); }
    for (const node of local.nodes) expect(positions.get(node.id)).toEqual(second.get(node.id));
  });

  it('does not reach past one step even with Shift', () => {
    const graph = compileSource("- [C] Top.\n  - [G] Middle.\n    - [G] Bottom.\n", 'document').graphs[0];
    const topology = projectGraph(graph);
    const positions = new Map(layoutGraph(topology).map(n => [n.id, { x: n.x, y: n.y }]));
    const id = (text: string) => topology.nodes.find(n => n.text === text)!.id;
    positions.get(id('Bottom.'))!.x += 200;
    const before = structuredClone(positions);
    const motion = createDragMotion(topology, positions, id('Bottom.'), new Set([id('Bottom.')]), 'down', 'step');
    for (let i = 1; i <= 60; i++) motion.step(i * 1000 / 60);
    expect(positions.get(id('Middle.'))).not.toEqual(before.get(id('Middle.')));
    expect(positions.get(id('Top.'))).toEqual(before.get(id('Top.')));
  });
});
