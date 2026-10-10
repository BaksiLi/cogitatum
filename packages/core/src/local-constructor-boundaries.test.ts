import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";

describe("nearest constructor failure boundaries", () => {
  it.each(["[O?]", "[O @one @two]", "[G; @one; @two]", "[? @one @two]", "[@one @two]", "[O @one", "[]"])("retains %s as a failed Point boundary through body", header => {
    const ast = parseDocument("- [C @outer] Outer claim.\n  - " + header + " Failed content.\n    - Narrative.\n      - [G @child] A valid child.\n        - [O @local] Its objection.\n    - [O @independent -> @outer] Independent relation.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(ast.blocks[0].children[0].annotation?.kind).toBe("invalid");
    expect(graph.points.map(point => point.id)).toEqual(["outer", "child", "local", "independent"]);
    expect(graph.bearings.map(bearing => ({ kind: bearing.kind, source: graph.points.find(point => point.key === bearing.sources[0].key)?.id, target: graph.points.find(point => point.key === bearing.target.key)?.id }))).toEqual([
      { kind: "challenges", source: "local", target: "child" },
      { kind: "challenges", source: "independent", target: "outer" }
    ]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET");
    expect(explain.entries[1].recognition).toEqual({ kind: "invalid" });
    expect(explain.entries[3].effects).toContainEqual({ kind: "rejectBearing", reason: "failed-context-requires-explicit-target" });
  });

  it("keeps valid Point focus when only its explicit attachment is malformed", () => {
    const { graph } = compileGraphWithExplain(parseDocument("- [C @outer] Outer.\n  - [O @objection +>] Malformed attachment.\n    - [G @child] Ground for the objection."));
    expect(graph.points.map(point => point.id)).toEqual(["outer", "objection", "child"]);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].target.key).toBe(graph.points[1].key);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["MALFORMED_EXPLICIT_BEARING"]);
  });

  it("retains duplicate Point and failed Bearing boundaries without searching outward", () => {
    const result = compileGraphWithExplain(parseDocument("- [C @outer] Outer.\n  - [G @duplicate] First.\n  - [G @duplicate] Second.\n    - [G @child] Child.\n  - [edge @missing +> @outer]\n    - [G @blocked] Blocked."));
    expect(result.graph.points.map(point => point.id)).toEqual(["outer", "child", "blocked"]);
    expect(result.graph.bearings).toEqual([]);
    expect(result.graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["DUPLICATE_ID", "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET", "UNKNOWN_SOURCE"]);
  });

  it("keeps ordinary bracket prose transparent and maps failed constructors in host source", () => {
    const source = "- [C @outer] 😀 Outer.\n  - [Context for the reader] Narrative.\n    - [G @valid] Valid support.\n  - [O?] Failed annotation.\n    - [G @blocked] Blocked support.";
    const fence = String.fromCharCode(96).repeat(3);
    const result = explainSource("Intro.\n\n" + fence + "cog\n" + source + "\n" + fence, "host");
    expect(result.graphs[0].bearings).toHaveLength(1);
    expect(result.graphs[0].bearings[0].sources[0].key).toBe(result.graphs[0].points.find(point => point.id === "valid")?.key);
    expect(result.explanations[0].entries[3]).toMatchObject({ recognition: { kind: "invalid" }, sourceSpan: { startLine: 7, startColumn: 5 } });
    expect(result.graphs[0].points.find(point => point.id === "blocked")?.sourceSpan?.startLine).toBe(8);
  });
});
