import { layoutGraph } from "./layout.js";
import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { focusNeighborhood, guidanceSubject, projectExploration, projectGraph, referenceKey } from "./projection.js";

describe("faithful graph projection", () => {
  it("makes object notes discoverable without changing graph topology or main content", () => {
    const graph = compileSource("- [C @c] Claim.\n  - [. note] First.\n  - [. note] Same.\n  - [G; @r] Reason.\n    - [_ note] Route.\n- [_ use @r]").graphs[0];
    const projected = projectGraph(graph);
    expect(projected.nodes).toHaveLength(3);
    expect(projected.links).toHaveLength(2);
    expect(projected.nodes.find(node => node.name === "c")).toMatchObject({ text: "Claim.", noteCount: 2 });
    expect(projectExploration(projected).inlineBearings[0]).toMatchObject({ name: "r", noteCount: 1 });
    graph.notes[0].target.key = "missing";
    expect(() => projectGraph(graph)).toThrow("dangling note target");
  });

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
  it("requires source recompilation across the published format boundary", () => {
    const graph = compileSource("- [C] Claim.").graphs[0];
    expect(() => projectGraph({ ...graph, version: "0.5.0" })).toThrow("Recompile retained source");
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
  // An author keeps the original route and adds a better one; the reader examines one route at a time.
  const alternativeRoutes = [
    "- [C @water] Broad Street 水泵可能是這次霍亂暴發的來源。",
    "- [G @cluster] 多數死亡病例集中在水泵周邊。",
    "- [edge @cluster +> @water; @proximity] 地理上的接近，可能反映飲用該水泵水的機會。",
    "- [O @exceptions /> @proximity] 附近濟貧院與啤酒廠幾乎沒有病例。",
    "- [G @exposure] 這兩處不用該水泵；一些遠處患者卻曾飲用泵水。",
    "- [edge @cluster, @exposure +> @water; @water-route] 真正重要的是飲水暴露，而不只是地理位置。"
  ].join("\n");

  it("separates alternative routes that share a source and a target", () => {
    const compiled = compileSource(alternativeRoutes, "document");
    expect(compiled.diagnostics).toEqual([]);
    const graph = compiled.graphs[0], projection = projectGraph(graph);
    const bearing = (handle: string) => graph.bearings.find(b => b.handle === handle)!;
    const objection = graph.bearings.find(b => b.kind === "challenges")!;
    const names = (ids: string[]) => ids.map(id => projection.nodes.find(node => node.id === id)!).map(node => node.name ?? node.ref.key);

    const original = focusNeighborhood(projection, { kind: "bearing", key: bearing("proximity").key });
    expect(original.bearingKeys).toEqual([bearing("proximity").key, objection.key]);
    expect(names(original.nodeIds)).toEqual(["water", "cluster", "exceptions", "proximity", objection.key]);

    // The objection addresses the proximity step, not the shared target or the alternative route.
    const alternative = focusNeighborhood(projection, { kind: "bearing", key: bearing("water-route").key });
    expect(alternative.bearingKeys).toEqual([bearing("water-route").key]);
    expect(names(alternative.nodeIds)).toEqual(["water", "cluster", "exposure", "water-route"]);

    // The shared target is where the routes meet, so its focus keeps both and the step objection.
    const target = focusNeighborhood(projection, { kind: "point", key: graph.points.find(p => p.id === "water")!.key });
    expect(target.bearingKeys).toEqual(graph.bearings.map(b => b.key));
  });

  it("keeps parallel Bearings of one kind between the same endpoints as distinct routes", () => {
    const graph = compileSource("- [C @c] Claim.\n- [G @a] Reason.\n- [edge @a +> @c; @first] One reading.\n- [edge @a +> @c; @second] Another reading.\n- [O /> @second] Doubt.", "document").graphs[0];
    const projection = projectGraph(graph);
    const [first, second, doubt] = graph.bearings;
    expect(focusNeighborhood(projection, { kind: "bearing", key: first.key }).bearingKeys).toEqual([first.key]);
    expect(focusNeighborhood(projection, { kind: "bearing", key: second.key }).bearingKeys).toEqual([second.key, doubt.key]);
  });

  it("lets a selection keep guidance while hover or focus previews only without one", () => {
    const route = { ref: { kind: "bearing" as const, key: "route" } }, other = { ref: { kind: "point" as const, key: "other" } };
    expect(guidanceSubject(route, other)).toBe(route);
    expect(guidanceSubject(undefined, other)).toBe(other);
    // A selected passage without a graph reference has no neighborhood to keep.
    const passage = { ref: undefined };
    expect(guidanceSubject(passage, other)).toBe(other);
    expect(guidanceSubject(passage, undefined)).toBe(passage);
  });

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


describe("Point focus includes direct context of its incident Bearings", () => {
  const graphFor = (lines: string[]) => {
    const compiled = compileSource(lines.join("\n"), "document");
    expect(compiled.diagnostics).toEqual([]);
    return compiled.graphs[0];
  };

  it.each(["challenges", "supports", "concerns"])("includes direct Point and step relations for %s", kind => {
    const graph = graphFor([
      "- [C @claim] Claim.", "  - [G @reason; @route] Reason.",
      "- [O @content -> @claim; @content-attack] Content objection.",
      "- [C @assessment] Assess the route.",
      `- [_ @assessment ${kind} @route; @step-assessment]`
    ]);
    const projection = projectGraph(graph), before = structuredClone(projection);
    const claim = graph.points.find(point => point.id === "claim")!;
    expect(focusNeighborhood(projection, { kind: "point", key: claim.key })).toEqual({
      nodeIds: projection.nodes.map(node => node.id),
      bearingKeys: graph.bearings.map(bearing => bearing.key)
    });
    expect(projection).toEqual(before);
  });

  it("retains all Linked sources and one level of assessment without following neighbouring Points", () => {
    const graph = graphFor([
      "- [C @claim] Claim.", "  - [_ G; @route]", "    - [. @a] First premise.", "    - [. @b] Second premise.",
      "- [O @objection /> @route; @attack] Step objection.",
      "- [O @reply /> @attack; @counterattack] A further objection.",
      "- [C @next] Later claim.", "- [_ @claim supports @next; @onward]"
    ]);
    const projection = projectGraph(graph);
    const point = graph.points.find(point => point.id === "a")!;
    const focus = focusNeighborhood(projection, { kind: "point", key: point.key });
    expect(focus.bearingKeys).toEqual(graph.bearings.filter(bearing => ["route", "attack"].includes(bearing.handle!)).map(bearing => bearing.key));
    expect(focus.nodeIds).toEqual(projection.nodes.filter(node => ["claim", "a", "b", "objection", "route", "attack"].includes(node.name!)).map(node => node.id));
    // Link ordering changes neither membership nor the projection's stable output order.
    expect(focusNeighborhood({ nodes: projection.nodes, links: [...projection.links].reverse() }, { kind: "point", key: point.key })).toEqual(focus);
    // Selecting a Bearing still includes only its own endpoints and immediate incoming relations.
    const route = graph.bearings.find(bearing => bearing.handle === "route")!;
    expect(focusNeighborhood(projection, { kind: "bearing", key: route.key })).toEqual(focus);
  });

  it("does not extend through a cycle or through newly included assessments", () => {
    const graph = graphFor([
      "- [C @a] First premise.", "- [C @b] Second premise.", "- [C @c] Assessment.", "- [C @d] Further assessment.",
      "- [_ @a supports @second; @first]", "- [_ @b concerns @first; @second]",
      "- [_ @c challenges @first; @assessment]", "- [_ @d concerns @assessment; @further]"
    ]);
    const projection = projectGraph(graph), point = graph.points.find(point => point.id === "a")!;
    const focus = focusNeighborhood(projection, { kind: "point", key: point.key });
    expect(focus.bearingKeys).toEqual(graph.bearings.filter(bearing => bearing.handle !== "further").map(bearing => bearing.key));
    expect(focus.nodeIds).toEqual(projection.nodes.filter(node => !["d", "further"].includes(node.name!)).map(node => node.id));
    expect(new Set(focus.nodeIds).size).toBe(focus.nodeIds.length);
  });
});
