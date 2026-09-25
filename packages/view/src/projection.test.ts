import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { layoutGraph, projectGraph, referenceKey } from "./projection.js";

describe("faithful graph projection", () => {
  it("retains joint support and pressure on that same bearing", () => {
    const graph = compileSource('- [C @c] Claim.\n- [G @a] First.\n- [G @b] Second.\n- [edge @a, @b +> @c; @route]\n- [O _> @route] Route objection.','document').graphs[0];
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
