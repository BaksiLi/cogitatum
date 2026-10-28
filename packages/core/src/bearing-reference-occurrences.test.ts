import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";
import type { GraphIR } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const declarations = "- [C @premise] Shared premise.\n- [C @claim] Shared claim.";
const route = "- [_ @premise supports @claim; @route] Original route description.";
const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
const relations = (graph: GraphIR) => {
  const names = new Map([...graph.points.map(point => [point.key, point.id] as const), ...graph.bearings.map(bearing => [bearing.key, bearing.handle] as const)]);
  return graph.bearings.map(bearing => ({ kind: bearing.kind, handle: bearing.handle, sources: bearing.sources.map(ref => names.get(ref.key)), target: { kind: bearing.target.kind, name: names.get(bearing.target.key) } }));
};

describe("reference-only Bearing occurrences", () => {
  it("keeps quoted source, reconstructed content and stronger local notes distinct in the reading fixture", () => {
    const source = readFileSync(new URL("../../../fixtures/core/bearing-reference-reading.cog.md", import.meta.url), "utf8");
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(7);
    const measurement = graph.points.find(point => point.id === "measurement")!;
    expect(measurement.text).toBe("In this room-temperature trial, drift was below 0.1% after ten minutes.");
    expect(ast.blocks[0].text).toContain("Quoted Monday record");
    expect(ast.blocks[1].text).toContain("Proposed reconstruction");
    expect(graph.points.find(point => point.id === "claim")!.text).toBe("This trial supports waiting ten minutes before sampling.");
    expect(ast.blocks[2].children[0].text).toBe("Ten minutes eliminates drift.");
    expect(explain.entries.find(entry => entry.sourceSpan.startLine === 7)!.effects).toContainEqual({ kind: "focusPoint", operand: { id: "measurement" }, ref: { kind: "point", key: measurement.key } });
    expect(graph.bearings.find(bearing => bearing.handle === "route")!.text).toBeUndefined();
    expect(explain.entries.filter(entry => entry.effects.some(effect => effect.kind === "focusBearing"))).toHaveLength(2);
  });

  it("maps repeated occurrences without overwriting the shared text or declaration span", () => {
    const ast = parseDocument(declarations + "\n" + route + "\n- [_ use @route] First note.\n- [_ use @route] A stronger paraphrase is still only a note.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0]).toMatchObject({ text: "Original route description.", sourceSpan: { startLine: 3 } });
    expect(ast.blocks[3]).toMatchObject({ text: "First note.", annotation: { kind: "bearingUse", ref: { id: "route" } } });
    for (const entry of explain.entries.slice(3)) {
      expect(entry.effects).toEqual([{ kind: "focusBearing", ref: { kind: "bearing", key: graph.bearings[0].key }, operand: { id: "route" } }]);
    }
  });

  it("keeps an absent Bearing description absent despite occurrence prose", () => {
    const { graph } = compile(declarations + "\n- [_ @premise +> @claim; @route]\n- [_ use @route] A note, not a route description.");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings[0].text).toBeUndefined();
  });

  it("matches constructed and referenced discussion endpoints with separate explanations", () => {
    const discussion = "\n  - [O/ @bias; @attack] Shared offset.\n    - [O @independent] Independent references.\n    - [O/ @cancellation] The offset cancels.\n    - [R @reply] Recalibration confirms it.";
    const created = compile(declarations + "\n" + route + discussion);
    const referenced = compile(declarations + "\n" + route + "\n- [_ use @route] Discuss the earlier route." + discussion);
    expect(codes(created.graph)).toEqual([]);
    expect(codes(referenced.graph)).toEqual([]);
    expect(relations(referenced.graph)).toEqual(relations(created.graph));
    expect(relations(referenced.graph).slice(1)).toEqual([
      { kind: "challenges", handle: "attack", sources: ["bias"], target: { kind: "bearing", name: "route" } },
      { kind: "challenges", handle: undefined, sources: ["independent"], target: { kind: "point", name: "bias" } },
      { kind: "challenges", handle: undefined, sources: ["cancellation"], target: { kind: "bearing", name: "attack" } },
      { kind: "respondsTo", handle: undefined, sources: ["reply"], target: { kind: "point", name: "bias" } }
    ]);
    expect(referenced.explain.entries[4].effects).toContainEqual({ kind: "selectBearing", contextSpan: referenced.explain.entries[3].sourceSpan, target: { kind: "bearing", key: referenced.graph.bearings[0].key } });
    expect(created.explain.entries[3].effects.some(effect => effect.kind === "selectAttachment")).toBe(true);
  });

  it("resolves forward Bearings and scoped reorder without replaying their subtrees", () => {
    const use = "- [_ use @route] Earlier discussion.\n  - [G/ @warrant] Warrant.";
    const before = compile(use + "\n" + declarations + "\n" + route + "\n  - [O/ @remote] Remote objection.");
    const after = compile(declarations + "\n" + route + "\n  - [O/ @remote] Remote objection.\n" + use);
    expect(codes(before.graph)).toEqual([]);
    expect(codes(after.graph)).toEqual([]);
    const sorted = (graph: GraphIR) => relations(graph).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));
    expect(sorted(before.graph)).toEqual(sorted(after.graph));
    expect(before.graph.points.filter(point => point.id === "remote")).toHaveLength(1);
    expect(before.explain.entries[0].effects).toContainEqual({ kind: "focusBearing", operand: { id: "route" }, ref: { kind: "bearing", key: before.graph.bearings.find(bearing => bearing.handle === "route")!.key } });
  });

  it("preserves distinct Bearing identities with the same endpoints", () => {
    const { graph } = compile(declarations + "\n" + route + "\n- [_ @premise supports @claim; @other]\n- [_ use @route]\n  - [O/ @first] First assessment.\n- [_ use @other]\n  - [O/ @second] Second assessment.");
    expect(codes(graph)).toEqual([]);
    expect(relations(graph).slice(2).map(bearing => bearing.target.name)).toEqual(["route", "other"]);
    expect(graph.bearings[0].key).not.toBe(graph.bearings[1].key);
  });

  it.each([
    ["premise", "POINT_IS_NOT_BEARING_REFERENCE", ""],
    ["missing", "UNKNOWN_BEARING_REFERENCE", ""],
    ["route", "INVALID_BEARING_REFERENCE", "\n- [_ @premise +> @claim; @route] Duplicate route."],
    ["failed", "INVALID_BEARING_REFERENCE", "\n- [_ @missing +> @claim; @failed] Failed route."],
    ["ambiguous", "INVALID_BEARING_REFERENCE", "\n- [C @ambiguous] A Point.\n- [_ @premise +> @claim; @ambiguous] Conflicting route."]
  ])("rejects %s focus while preserving independent descendants", (operand, diagnostic, extra) => {
    const source = declarations + "\n" + route + extra + "\n- [C @outer] Outer.\n  - [G @local; @outer-route] Local.\n    - [_ use @" + operand + "] Invalid focus.\n      - [G/ @dependent] Must not target the Point or outer route.\n      - [O/ @attack] Must not fall back.\n      - [G @independent +> @claim; @independent-route] Independent.";
    const { graph, explain } = compile(source);
    expect(codes(graph)).toContain(diagnostic);
    expect(graph.bearings.some(bearing => bearing.handle === "independent-route")).toBe(true);
    const dependentKeys = graph.points.filter(point => point.id === "dependent" || point.id === "attack").map(point => point.key);
    expect(graph.bearings.some(bearing => bearing.sources.some(ref => dependentKeys.includes(ref.key)))).toBe(false);
    expect(explain.entries.find(entry => entry.recognition.kind === "bearingUse")!.effects.some(effect => effect.kind === "rejectFocus")).toBe(true);
    expect(explain.entries.every(entry => entry.effects.every(effect => effect.kind !== "selectBearing" || !effect.target))).toBe(true);
  });

  it.each(["_ use @route; @alias", "_ use @route +> @claim", "_ use @route supports @claim", "_ use", "_ USE @route", "_ use @route @other"])("keeps malformed [%s] as a failed Bearing boundary", annotation => {
    const ast = parseDocument(declarations + "\n" + route + "\n- [C @outer] Outer.\n  - [G; @outer-route] Local.\n    - [" + annotation + "] Bad use.\n      - [O/] Must not target outer-route.\n      - [G +> @claim; @independent] Independent.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toContain("MALFORMED_BEARING_USE");
    expect(ast.blocks[3].children[0].children[0].annotation).toMatchObject({ kind: "bearingUse", syntaxErrors: ["reference"] });
    expect(relations(graph).map(bearing => bearing.handle)).toEqual(["route", "outer-route", "independent"]);
    expect(explain.entries.find(entry => entry.recognition.kind === "bearingUse")!.effects.some(effect => effect.kind === "rejectFocus" && effect.reason === "annotation-syntax-error")).toBe(true);
  });

  it("retains an unclosed use prefix and independent relations", () => {
    const ast = parseDocument(declarations + "\n" + route + "\n- [_ use @route\n  - [O/] Not an outer attachment.\n  - [G +> @claim; @independent] Independent.");
    const { graph } = compileGraphWithExplain(ast);
    expect(ast.blocks[3].annotation).toMatchObject({ kind: "bearingUse", syntaxErrors: ["reference"] });
    expect(codes(graph)).toContain("MALFORMED_ANNOTATION_PREFIX");
    expect(relations(graph).map(bearing => bearing.handle)).toEqual(["route", "independent"]);
  });

  it("lets Point frames shadow Bearing focus without remote attachment lookup", () => {
    const { graph } = compile(declarations + "\n" + route + "\n- [_ use @route]\n  - [. use @premise] Neutral use.\n    - [O/] Cannot recover route.\n  - [C @local +> @claim; @local-route] Local Point.\n    - [O/ @local-objection] Selects only local-route.\n  - [O @ordinary] No implicit Point target.");
    expect(codes(graph)).toContain("NO_LOCAL_BEARING_ATTACHMENT");
    expect(codes(graph)).toContain("BEARING_USE_REQUIRES_EXPLICIT_TARGET");
    expect(relations(graph).map(bearing => bearing.target.name)).toEqual(["claim", "claim", "local-route"]);
  });

  it("retains typed explicit target checks within Bearing discussions", () => {
    const { graph } = compile(declarations + "\n" + route + "\n- [_ use @route]\n  - [O -> @route] General challenge to a Bearing.\n  - [R respondsTo @route] Wrong Point-only target.\n  - [O -> @route] Correct.");
    expect(codes(graph)).toEqual(["BEARING_KIND_REQUIRES_POINT_TARGET"]);
    expect(graph.bearings).toHaveLength(3);
  });

  it.each(["route", "missing", "route; @alias", "route _> @claim"])("keeps direct Bearing use %s independent of linked sources", operand => {
    const source = declarations + "\n" + route + "\n- [C @joint-target] Joint target.\n  - [_ +> ^; @joint]\n    - [. use @premise]\n      - [O/] A member has no unary attachment.\n    - [_ use @" + operand + "] Independent occurrence.\n      - [O/ @assessment] Assess the reference.\n    - [. @second] Second source.";
    const { graph, explain } = compile(source);
    expect(relations(graph).find(bearing => bearing.handle === "joint")).toEqual({ kind: "supports", handle: "joint", sources: ["premise", "second"], target: { kind: "point", name: "joint-target" } });
    const entry = explain.entries.find(entry => entry.recognition.kind === "bearingUse")!;
    expect(entry.effects).toContainEqual({ kind: "localBearingMember", localBearingSpan: explain.entries[4].sourceSpan, eligible: false, function: "independent" });
    const assessment = relations(graph).find(bearing => bearing.sources.includes("assessment"));
    if (operand === "route") expect(assessment?.target).toEqual({ kind: "bearing", name: "route" });
    else expect(assessment).toBeUndefined();
    expect(codes(graph)).toContain("NO_LOCAL_BEARING_ATTACHMENT");
  });

  it("requires sources in a use-only linked and never crosses a Bearing-use boundary", () => {
    const { graph } = compile(declarations + "\n" + route + "\n- [C @outer] Outer.\n  - [_ +> ^; @empty]\n    - [_ use @route]\n  - [_ use @route]\n    - [_ +> ^; @nested]\n      - [. @member] Not support for outer.");
    expect(codes(graph)).toContain("EMPTY_LOCAL_BEARING");
    expect(codes(graph)).toContain("LOCAL_BEARING_REQUIRES_POINT_TARGET");
    expect(relations(graph).map(bearing => bearing.handle)).toEqual(["route"]);
  });

  it("rejects an atomic source set despite independent Bearing discussion", () => {
    const { graph } = compile(declarations + "\n" + route + "\n- [C @joint-target] Joint target.\n  - [_ +> ^; @joint]\n    - [. use @premise]\n    - [. use @premise]\n    - [_ use @route]\n      - [O/ @assessment] Independent.");
    expect(codes(graph)).toContain("DUPLICATE_BEARING_SOURCES");
    expect(relations(graph).map(bearing => bearing.handle)).toEqual(["route", undefined]);
    expect(relations(graph)[1].target.name).toBe("route");
  });

  it("propagates failed Bearing dependencies before accepting a reference focus", () => {
    const { graph, explain } = compile(declarations + "\n- [_ @missing +> @claim; @failed]\n- [_ @premise +> @failed; @dependent]\n- [_ use @dependent]\n  - [G/ @warrant; @downstream] Dependent.\n    - [O/ @attack] Also dependent.\n  - [G @independent +> @claim; @independent-route] Independent.");
    expect(codes(graph)).toContain("INVALID_BEARING_REFERENCE");
    expect(relations(graph).map(bearing => bearing.handle)).toEqual(["independent-route"]);
    expect(explain.entries[4].effects).toContainEqual({ kind: "rejectFocus", operand: { id: "dependent" }, reason: "reference-error" });
  });

  it("allows explicit graph cycles without recursive source expansion", () => {
    const { graph, explain } = compile("- [_ use @cycle]\n  - [G/ @premise; @cycle] A self-referential route.");
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(1);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
    expect(explain.entries[0].effects).toContainEqual({ kind: "focusBearing", operand: { id: "cycle" }, ref: graph.bearings[0].target });
  });

  it("maps emoji/CRLF host notes to original UTF-16 spans and isolates unit namespaces", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const source = ["Intro 😀", fence + "cog", declarations, route, "- [_ use @route] Local 😀 note.", "  - [O/] Assessment.", fence, "", fence + "cog", "- [_ use @route] Another unit.", fence].join("\n").replaceAll("\n", "\r\n");
    const result = explainSource(source, "host");
    expect(result.graphs).toHaveLength(2);
    expect(codes(result.graphs[0])).toEqual([]);
    expect(codes(result.graphs[1])).toContain("UNKNOWN_BEARING_REFERENCE");
    const entry = result.explanations[0].entries.find(entry => entry.recognition.kind === "bearingUse")!;
    const line = source.split("\r\n")[entry.sourceSpan.startLine - 1];
    expect(line.slice(entry.sourceSpan.startColumn - 1, entry.sourceSpan.endColumn - 1)).toBe("[_ use @route] Local 😀 note.");
    expect(entry.sourceSpan).toMatchObject({ startLine: 6, startColumn: 3, endColumn: line.length + 1 });
    expect(result.graphs[0].bearings[0].sourceSpan?.startLine).toBe(5);
    expect(result.documents[0].blocks[3].text).toBe("Local 😀 note.");
  });
});
