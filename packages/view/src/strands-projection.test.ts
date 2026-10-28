import { describe, expect, it } from "vitest";
import { compileSource } from "../../core/src/index.js";
import { projectContest, projectStrands, strandRootOf, strandRoots, type StrandRow } from "./strands-projection.js";

const snow = [
  "- [C @water] The pump was the source.",
  "  - [G @cluster; @proximity] Deaths clustered around the pump.",
  "    - [O/ @exceptions] The workhouse had almost no cases.",
  "      - [R @wells] It had its own well.",
  "  - [G @exposure; @route] Distant victims drank pump water.",
  "    - [_ +> ^]",
  "      - [. @widow] A widow had pump water delivered.",
  "      - [. @niece] Her niece also died.",
  "    - [G use @cluster] The cluster fits exposure.",
  "  - [O @miasma] Miasma explains it better.",
  "- [Q @next] What should the parish do?"
].join("\n");
const graph = compileSource(snow, "document").graphs[0];
const id = (key: string) => graph.points.find(p => p.key === key)?.id;
const pointRows = (rows: StrandRow[]) => rows.filter((row): row is Extract<StrandRow, { kind: "point" }> => row.kind === "point");

describe("Strands projection", () => {
  it("requires a graph compiled under the current format", () => {
    expect(() => projectStrands({ ...graph, version: "cogitatum/0.5" } as unknown as typeof graph)).toThrow("Recompile retained source");
  });

  it("chooses endings that bear on nothing, in source order", () => {
    expect(strandRoots(graph).map(p => p.id)).toEqual(["water"]);
    expect(strandRootOf(graph, { kind: "point", key: graph.points.find(p => p.id === "niece")!.key })?.id).toBe("water");
  });

  it("locates objections and responses through the actual step they address", () => {
    for (const name of ["exceptions", "wells", "miasma"]) {
      const point = graph.points.find(point => point.id === name)!;
      expect(strandRootOf(graph, { kind: "point", key: point.key })?.id).toBe("water");
    }
  });

  it("places every Point above what it rests on, merging a shared Point into one lane", () => {
    const strands = projectStrands(graph)!;
    const order = pointRows(strands.rows).map(row => id(row.point.key));
    expect(order[0]).toBe("water");
    expect(new Set(order)).toEqual(new Set(["water", "cluster", "exposure", "widow", "niece"]));
    expect(order.indexOf("exposure")).toBeLessThan(order.indexOf("cluster"));
    expect(order.filter(name => name === "cluster")).toHaveLength(1);
    const exposure = pointRows(strands.rows).find(row => id(row.point.key) === "exposure")!;
    const joint = exposure.steps.find(step => step.bearing.sources.length === 2)!;
    expect(joint.lanes).toHaveLength(2);
    const cluster = pointRows(strands.rows).find(row => id(row.point.key) === "cluster")!;
    expect(cluster.via.map(b => b.target.key).map(id).sort()).toEqual(["exposure", "water"]);
    expect(cluster.cycles).toEqual([]);
  });

  it("puts a challenge on the step it contests and one on a Point at that Point", () => {
    const strands = projectStrands(graph)!;
    const knot = strands.rows.find((row): row is Extract<StrandRow, { kind: "knot" }> => row.kind === "knot")!;
    expect(knot.knot).toMatchObject({ polarity: "challenge", on: { kind: "bearing" } });
    expect(graph.bearings.find(b => b.key === knot.knot.on.key)?.handle).toBe("proximity");
    expect(knot.knot.relations.map(relation => relation.kind)).toEqual(["respondsTo"]);
    const next = strands.rows[strands.rows.indexOf(knot) + 1];
    expect(next.kind === "point" && id(next.point.key)).toBe("cluster");
    const water = pointRows(strands.rows)[0];
    expect(water.knots.map(k => k.bearing.sources.map(s => id(s.key)))).toEqual([["miasma"]]);
    expect(strands.outside).toEqual({ points: 1, bearings: 0 });
  });

  it("counts a deeper relation once when direct relations share their source Point", () => {
    const source = [
      "- [C] Claim.", "  - [G; @step] Ground.", "    - [O/ @o] Objection.",
      "      - [R @r] Response.", "        - [G] Its reason.", "      - [R use @r] The same response."
    ].join("\n");
    const strands = projectStrands(compileSource(source, "document").graphs[0])!;
    const knot = strands.rows.find((row): row is Extract<StrandRow, { kind: "knot" }> => row.kind === "knot")!.knot;
    expect(knot.relations).toHaveLength(2);
    expect(knot.further).toBe(1);
  });

  it("lights a contest from the focus to the contested step and what it rests on", () => {
    const strands = projectStrands(graph)!;
    const knot = strands.rows.findIndex(row => row.kind === "knot");
    const lit = [...projectContest(strands, (strands.rows[knot] as Extract<StrandRow, { kind: "knot" }>).knot.bearing.key).rows];
    const names = lit.map(index => strands.rows[index]).map(row => row.kind === "point" ? id(row.point.key) : "knot").sort();
    expect(names).toEqual(["cluster", "knot", "water"]);
  });

  it("keeps an alternative route distinct when it shares the contested route's Ground", () => {
    const source = [
      "- [C @water] Pump water.", "  - [G @cluster; @proximity] Nearby cases.",
      "    - [O/ @exceptions] Nearby exceptions.", "  - [_ +> ^; @route] Exposure.",
      "    - [. use @cluster]", "    - [. @exposure] Distant drinkers.",
      "    - [O/ @other] A different objection."
    ].join("\n");
    const graph = compileSource(source, "document").graphs[0];
    const strands = projectStrands(graph)!;
    const step = graph.bearings.find(bearing => bearing.handle === "proximity")!;
    const alternative = graph.bearings.find(bearing => bearing.handle === "route")!;
    const objection = graph.bearings.find(bearing => bearing.target.kind === "bearing" && bearing.target.key === step.key)!;
    const scope = projectContest(strands, objection.key);
    expect(scope.bearingKeys.has(step.key)).toBe(true);
    expect(scope.bearingKeys.has(alternative.key)).toBe(false);
    const knots = [...scope.rows].map(index => strands.rows[index]).filter(row => row.kind === "knot");
    expect(knots).toHaveLength(1);
    expect(knots[0].knot.on.key).toBe(step.key);
    expect(projectContest(strands, "missing").rows.size).toBe(0);
  });

  it("refocuses on another ending and records a cycle instead of repeating a Point", () => {
    const cyclic = compileSource("- [C @a] A.\n  - [G @b] B.\n    - [G use @a] A again.", "document").graphs[0];
    const strands = projectStrands(cyclic)!;
    expect(strands).toBeDefined();
    expect(strands.roots).toEqual([]);
    const rows = pointRows(strands.rows);
    expect(rows.map(row => row.point.id)).toEqual(["a", "b"]);
    expect(rows[1].cycles.map(p => p.id)).toEqual(["a"]);
    const other = projectStrands(graph, { kind: "point", key: graph.points.find(p => p.id === "exposure")!.key })!;
    expect(pointRows(other.rows).map(row => id(row.point.key))[0]).toBe("exposure");
    expect(projectStrands(compileSource("", "document").graphs[0])).toBeUndefined();
  });
});
