import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { projectExploration, projectGraph, referenceKey } from "./projection.js";
import { layoutFlow, layoutGraphSettled, relaxLayout } from "./layout.js";
import { BEARING_MARKS, POINT_MARKS, bearingMark, isJoint, pointMark } from "./marks.js";

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");
const explore = (source: string, mode: "document" | "host" = "document") => {
  const graph = compileSource(source, mode).graphs[0];
  const full = projectGraph(graph), exploration = projectExploration(full);
  return { graph, full, exploration, topology: { nodes: exploration.nodes, links: exploration.links } };
};

describe("independent and joint support stay distinct in the visual topology", () => {
  it("draws each independent Ground as its own line and the joint as one junction with two inputs", () => {
    const { graph, exploration } = explore(fixture("core/independent-and-joint-support.cog.md"));
    const supports = graph.bearings.filter(b => b.kind === "supports");
    const independent = supports.filter(b => !isJoint(b.sources)), joint = supports.filter(b => isJoint(b.sources));
    expect(independent).toHaveLength(2); expect(joint).toHaveLength(1);
    const inline = new Set(exploration.inlineBearings.map(n => n.ref.key));
    for (const b of independent) expect(inline.has(b.key)).toBe(true);
    expect(inline.has(joint[0].key)).toBe(false);
    const junction = referenceKey({ kind: "bearing", key: joint[0].key });
    expect(exploration.links.filter(l => l.target === junction && l.segment === "input")).toHaveLength(2);
    // Each collapsed line still identifies exactly one Bearing; no two independent supports share one.
    const outputs = exploration.links.filter(l => l.segment === "output" && inline.has(l.bearingKey)).map(l => l.bearingKey);
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it("keeps a linked block, its singleton form and pressure on the joint Bearing addressable", () => {
    const local = explore(fixture("core/local-linked.cog.md"));
    const route = local.graph.bearings.find(b => b.handle === "joint-route")!;
    expect(route.sources).toHaveLength(2);
    const id = referenceKey({ kind: "bearing", key: route.key });
    expect(local.exploration.nodes.some(n => n.id === id)).toBe(true);
    expect(local.exploration.links.some(l => l.segment === "output" && l.target === id)).toBe(true);
    const host = explore(fixture("host/local-linked.md"), "host");
    const single = host.graph.bearings.find(b => b.handle === "route")!;
    expect(single.sources).toHaveLength(1);
    // Addressed by an undercut, so it remains a junction even with one source; nothing is invented.
    expect(host.exploration.nodes.some(n => n.id === referenceKey({ kind: "bearing", key: single.key }))).toBe(true);
    expect(host.exploration.links.filter(l => l.bearingKey === single.key && l.segment === "input")).toHaveLength(1);
  });
});

describe("reading layout", () => {
  it("places what is borne upon above what bears on it, deterministically", () => {
    const { topology, graph } = explore(fixture("core/independent-and-joint-support.cog.md"));
    const placed = layoutFlow(topology);
    expect(layoutFlow(topology)).toEqual(placed);
    const y = new Map(placed.map(n => [n.id, n.y]));
    for (const link of topology.links) if (link.source !== link.target) expect(y.get(link.target)!).toBeLessThan(y.get(link.source)!);
    expect(placed.map(({ x, y, ...node }) => node)).toEqual(topology.nodes);
    expect(graph.points.length + graph.bearings.length).toBeGreaterThan(placed.length);
  });

  it("separates disconnected fragments and keeps every point readable apart", () => {
    const { topology } = explore("- [Q] One?\n  - [C] Answer.\n- [O] A top-level objection stays a Point.\n- [?] A gap.\n  - [C] A claim under a gap.");
    const placed = layoutFlow(topology);
    expect(placed).toHaveLength(topology.nodes.length);
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      expect(Math.abs(a.x - b.x) >= 80 || Math.abs(a.y - b.y) >= 70).toBe(true);
    }
  });

  it("relaxes without moving pinned nodes and never touches the projection", () => {
    const { topology } = explore(fixture("core/local-linked.cog.md"));
    const before = structuredClone(topology);
    const seed = layoutFlow(topology);
    const positions = new Map(seed.map(n => [n.id, { x: n.x, y: n.y }]));
    const pinned = seed[0].id, at = { ...positions.get(pinned)! };
    relaxLayout(topology, positions, { iterations: 30, pinned: new Set([pinned]) });
    expect(positions.get(pinned)).toEqual(at);
    expect([...positions.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(layoutGraphSettled(topology)).toEqual(layoutGraphSettled(topology));
    expect(topology).toEqual(before);
  });
});

describe("shared mark vocabulary", () => {
  it("uses canonical names and keeps openness only on Gap", () => {
    expect(Object.values(POINT_MARKS).map(m => m.name)).toEqual(["Question", "Claim", "Ground", "Objection", "Reply", "Distinction", "Gap", "Material"]);
    expect(Object.values(POINT_MARKS).filter(m => m.shape === "gap").map(m => m.label)).toEqual(["Gap"]);
    expect(pointMark("Material").shape).toBe("material");
    expect(pointMark("O").zh).toBe("駁議");
    expect(bearingMark("undercuts").zh).toBe("質疑關係");
    expect(bearingMark("about").tone).toBe("neutral");
    expect(Object.keys(BEARING_MARKS).sort()).toEqual(["about", "answers", "challenges", "clarifies", "repliesTo", "supports", "undercuts"]);
  });
});
