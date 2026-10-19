import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { focusNeighborhood, layoutConstellation, layoutGraph, projectExploration, projectGraph, referenceKey } from "./projection.js";

describe("faithful graph projection", () => {
  it("keeps the typed endpoint when both content and route objections are challenges", () => {
    const graph = compileSource('- [C @c] Claim.\n  - [G; @route] Reason.\n- [O -> @c; @content] Content objection.\n- [O /> @route; @step] Step objection.', 'document').graphs[0];
    const topology = projectGraph(graph);
    const display = projectExploration(topology);
    const challenges = graph.bearings.filter(b => b.kind === 'challenges');
    expect(challenges.map(b => b.target.kind)).toEqual(['point', 'bearing']);
    for (const bearing of challenges) {
      expect(topology.links).toContainEqual(expect.objectContaining({ bearingKey: bearing.key, target: referenceKey(bearing.target), segment: 'output' }));
      expect(display.links).toContainEqual(expect.objectContaining({ bearingKey: bearing.key, target: referenceKey(bearing.target), segment: 'output' }));
    }
    expect(display.nodes.some(node => node.ref.kind === 'bearing' && node.ref.key === graph.bearings[0].key)).toBe(true);
  });
  it("retains joint support and pressure on that same bearing", () => {
    const graph = compileSource('- [C @c] Claim.\n- [G @a] First.\n- [G @b] Second.\n- [edge @a, @b +> @c; @route]\n- [O /> @route] Route objection.','document').graphs[0];
    const p = projectGraph(graph);
    expect(p.nodes).toHaveLength(6); expect(p.links).toHaveLength(5);
    const route = graph.bearings.find(b=>b.handle==='route')!;
    const inputs = p.links.filter(l=>l.target===`bearing:${route.key}` && l.segment==='input');
    expect(inputs).toHaveLength(2);
    expect(p.links.some(l=>l.segment==='output' && l.target===`bearing:${route.key}`)).toBe(true);
    expect(p.nodes.find(n=>n.name==='c')?.sourceSpan?.startLine).toBe(1);
    expect(layoutGraph(p)).toEqual(layoutGraph(p));
  });
  it("uses reference kind rather than parsing key prefixes", () => {
    expect(referenceKey({kind:'bearing',key:'same'})).not.toBe(referenceKey({kind:'point',key:'same'}));
  });
  it("lays out cycles finitely without dropping entities", () => {
    const graph = compileSource('- [C @a +> @b] A.\n- [C @b +> @a] B.','document').graphs[0];
    const positioned = layoutGraph(projectGraph(graph));
    expect(positioned).toHaveLength(4);
    expect(positioned.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y))).toBe(true);
  });
  it("rejects corrupt graph endpoints instead of drawing an invented connection", () => {
    const graph = compileSource('- [C] A.\n  - [G] B.','document').graphs[0];
    graph.points.pop(); expect(()=>projectGraph(graph)).toThrow('dangling');
  });
});


describe("settled constellation layout", () => {
  it("keeps every joint source and bearing target, with deterministic, separated positions", () => {
    const source = '- [C @c] Claim.\n- [G @a] First.\n- [G @b] Second.\n- [edge @a, @b +> @c; @route]\n- [O /> @route] Route objection.';
    const projection = projectGraph(compileSource(source, 'document').graphs[0]);
    const before = structuredClone(projection);
    const positioned = layoutConstellation(projection);
    expect(positioned).toEqual(layoutConstellation(projection));
    expect(positioned.map(({x, y, ...node}) => node)).toEqual(projection.nodes);
    expect(projection).toEqual(before);
    for (let i = 0; i < positioned.length; i++) for (let j = i + 1; j < positioned.length; j++) {
      const a = positioned[i], b = positioned[j];
      const width = 100;
      const height = (a.ref.kind === 'point' ? 58 : 44) + (b.ref.kind === 'point' ? 58 : 44);
      expect(Math.abs(a.x - b.x) >= width || Math.abs(a.y - b.y) >= height).toBe(true);
    }
  });
  it("handles empty, disconnected and cyclic fragments without inventing connections", () => {
    expect(layoutConstellation({nodes: [], links: []})).toEqual([]);
    for (const source of ['- [C @a] A.\n- [Q @b] B.', '- [C @a +> @b] A.\n- [C @b +> @a] B.']) {
      const projection = projectGraph(compileSource(source, 'document').graphs[0]);
      const positioned = layoutConstellation(projection);
      expect(positioned).toHaveLength(projection.nodes.length);
      expect(positioned.every(node => Number.isFinite(node.x) && Number.isFinite(node.y) && node.x >= 0 && node.y >= 0)).toBe(true);
    }
  });
});


describe("exploration presentation", () => {
  it("draws a simple Bearing as one selectable line with its original identity", () => {
    const graph = compileSource('- [C @c] Claim.\n  - [G @a] Reason.', 'document').graphs[0];
    const canonical = projectGraph(graph), before = structuredClone(canonical);
    const display = projectExploration(canonical);
    expect(display.nodes).toHaveLength(2);
    expect(display.inlineBearings).toHaveLength(1);
    expect(display.links).toEqual([{ source: referenceKey(graph.bearings[0].sources[0]), target: referenceKey(graph.bearings[0].target), bearingKey: graph.bearings[0].key, segment: 'output' }]);
    expect(display.inlineBearings[0].ref).toEqual({kind: 'bearing', key: graph.bearings[0].key});
    expect(canonical).toEqual(before);
  });
  it("keeps joint support and an addressed connection as explicit junctions", () => {
    for (const source of [
      '- [C @c] Claim.\n- [G @a] First.\n- [G @b] Second.\n- [edge @a, @b +> @c; @route]',
      '- [C @c] Claim.\n- [G @a +> @c; @route] First.\n- [O @o /> @route; @pressure] Weak route.'
    ]) {
      const graph = compileSource(source, 'document').graphs[0];
      const display = projectExploration(projectGraph(graph));
      const route = graph.bearings.find(b => b.handle === 'route')!;
      expect(display.nodes.some(node => node.ref.kind === 'bearing' && node.ref.key === route.key)).toBe(true);
      expect(display.inlineBearings.some(node => node.ref.key === route.key)).toBe(false);
      expect(display.links.filter(link => link.bearingKey === route.key && link.segment === 'input')).toHaveLength(route.sources.length);
    }
  });
  it("does not hide distinct parallel, opposite or self-directed relationships", () => {
    for (const source of [
      '- [C @c] Claim.\n- [G @a] Reason.\n- [edge @a +> @c]\n- [edge @a -> @c]',
      '- [C @a +> @b] A.\n- [C @b +> @a] B.',
      '- [C @a +> @a] A.'
    ]) {
      const projection = projectGraph(compileSource(source, 'document').graphs[0]);
      const display = projectExploration(projection);
      expect(display.inlineBearings).toEqual([]);
      expect(display.nodes).toEqual(projection.nodes);
      expect(display.links).toEqual(projection.links);
    }
  });
});

describe("focus neighborhood", () => {
  it("includes a whole joint Bearing without following further implications", () => {
    const graph = compileSource('- [C @c] Claim.\n- [G @a] First.\n- [G @b] Second.\n- [C @d] Next.\n- [edge @a, @b +> @c; @route]\n- [edge @c +> @d; @next]', 'document').graphs[0];
    const route = graph.bearings.find(b => b.handle === 'route')!;
    const point = graph.points.find(p => p.id === 'a')!;
    const focus = focusNeighborhood(projectGraph(graph), {kind: 'point', key: point.key});
    expect(focus.bearingKeys).toEqual([route.key]);
    expect(focus.nodeIds).toHaveLength(4);
    expect(focus.nodeIds).not.toContain(referenceKey({kind: 'point', key: graph.points.find(p => p.id === 'd')!.key}));
  });
  it("includes pressure on a selected connection and all of its joint sources", () => {
    const graph = compileSource('- [C @c] Claim.\n- [G @a] First.\n- [G @b] Second.\n- [edge @a, @b +> @c; @route]\n- [O @o /> @route; @pressure] Weak route.', 'document').graphs[0];
    const route = graph.bearings.find(b => b.handle === 'route')!;
    const projection = projectGraph(graph);
    const focus = focusNeighborhood(projection, {kind: 'bearing', key: route.key});
    expect(focus.nodeIds).toEqual(projection.nodes.map(node => node.id));
    expect(focus.bearingKeys).toEqual(graph.bearings.map(b => b.key));
    expect(focusNeighborhood(projection, {kind: 'point', key: 'missing'})).toEqual({nodeIds: [], bearingKeys: []});
  });
});
