import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";
import type { BearingKind } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const codes = (source: string) => compile(source).graph.diagnostics.map(diagnostic => diagnostic.code);

describe("consolidated symbolic authoring", () => {
  it("keeps neutral Points distinct from transparent body and local answer/reply marks", () => {
    const { graph } = compile("- [Q @question] Question.\n  - [.] Neutral background.\n    - [G @reason] Supports the neutral Point.\n- [O @objection] Objection.\n  - [. @background] Neutral context.");
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["DISCONNECTED_ANCHORED_MATERIAL"]);
    expect(graph.points).toHaveLength(5);
    expect(graph.points[1]).toMatchObject({ declaration: { form: "material" }, text: "Neutral background." });
    expect(graph.points[1].id).toBeUndefined();
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].target).toEqual({ kind: "point", key: graph.points[1].key });
    expect(compile("- [C @claim] Claim.\n  - Body.\n    - [G] Reason.").graph.bearings[0].target.key).toBe("_p1");
  });

  it.each(["supports", "challenges", "undercuts", "about", "answers", "repliesTo", "clarifies"] satisfies BearingKind[])("uses one normalized explicit constructor for %s", kind => {
    const prefix = "- [. @source] Source.\n- [C @target] Target.\n- [edge @source +> @target; @route]\n";
    const target = kind === "undercuts" ? "route" : "target";
    const compact = compile(prefix + "- [_ @source " + kind + " @" + target + "; @current] Route description.");
    const readable = compile(prefix + "- [edge @source " + kind + " @" + target + "; @current] Route description.");
    expect(compact.graph.diagnostics).toEqual([]);
    expect(readable.graph.diagnostics).toEqual([]);
    expect(compact.graph.bearings.map(({ sourceSpan: _span, ...bearing }) => bearing)).toEqual(readable.graph.bearings.map(({ sourceSpan: _span, ...bearing }) => bearing));
    expect(compact.explain.entries[3].recognition).toEqual({ kind: "edge" });
    expect(compact.graph.points).toHaveLength(2);
    expect(compact.graph.bearings[1].text).toBe("Route description.");
  });

  it.each(["[_]", "[_ @source +>]", "[_; @bad]", "[_ @source"])("retains %s as a failed Bearing boundary", header => {
    const { graph, explain } = compile("- [. @source] Source.\n- [C @outer] Outer.\n  - " + header + "\n    - [G @child] Survives.\n      - [O] Its own subtree.\n    - [G @explicit +> @outer] Independent.");
    expect(explain.entries[2].recognition).toEqual({ kind: "edge" });
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["challenges", "supports"]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET");
  });

  it.each(["[@legacy]", "[use @source]", "[G_]", "[O_]", "[G _> @route]", "[_ @source _> @route]"])("rejects retired %s with migration guidance rather than a compiling alias", header => {
    const { graph } = compile("- [. @source] Source.\n- [C @claim] Claim.\n- [edge @source +> @claim; @route]\n- [C @outer] Outer.\n  - " + header + "\n    - [G/ @assessment] No attachment fallback.");
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("RETIRED_AUTHORING_SYNTAX");
    expect(graph.diagnostics.find(diagnostic => diagnostic.code === "RETIRED_AUTHORING_SYNTAX")?.message).toContain("migrate");
    expect(graph.bearings).toHaveLength(1);
    expect(graph.points.some(point => point.id === "legacy")).toBe(false);
  });

  it("retains retired-selector commentary without making it a linked source or shrinking the joint", () => {
    const { graph, explain } = compile("- [C @claim] Claim.\n  - [linked; @joint]\n    - [G @first] First.\n    - [G_] Retired commentary.\n    - [G @second] Second.");
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].sources.map(ref => graph.points.find(point => point.key === ref.key)?.id)).toEqual(["first", "second"]);
    expect(explain.entries[3].effects).toContainEqual({ kind: "linkedMember", linkedSpan: explain.entries[1].sourceSpan, eligible: false, function: "commentary" });
  });

  it("distinguishes local inquiry presentation from conversion, mutation or inherited answer context", () => {
    const source = "- [Q @question] When should sampling begin?\n- [C @assertion] The road is wet.\n- [. use @question]\n  - [C @background] Background.\n- [Q use @question]\n  - [C @answer] Candidate answer.\n- [Q use @assertion]\n  - [C @discussion] A locally authored response.\n- [C? use @assertion] Unsupported occurrence openness.";
    const { graph } = compile(source);
    expect(graph.points).toHaveLength(5);
    expect(graph.points[1]).toMatchObject({ text: "The road is wet.", declaration: { form: "role", role: "C" } });
    expect(graph.bearings.map(bearing => [bearing.kind, graph.points.find(point => point.key === bearing.target.key)?.id])).toEqual([["answers", "question"], ["answers", "assertion"]]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["RETIRED_CLAIM_OPENNESS"]);
  });

  it("uses Gap content as a Ground without filling, resolving or removing it", () => {
    const { graph } = compile("- [? @record] A calibration record is missing.\n- [C @claim] Accuracy cannot yet be established.\n  - [G use @record]");
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points[0]).toMatchObject({ declaration: { form: "gap", status: "open" }, text: "A calibration record is missing." });
    expect(graph.bearings[0].kind).toBe("supports");
  });

  it("keeps authored negative target checks after adopting slash", () => {
    const source = "- [. @source] Source.\n- [C @claim] Claim.\n- [_ @source +> @claim; @route]\n- [O -> @route] Wrong Point target.\n- [O /> @claim] Wrong Bearing target.";
    expect(codes(source)).toEqual(["CHALLENGE_REQUIRES_POINT_TARGET", "UNDERCUT_REQUIRES_BEARING_TARGET"]);
    expect(compile(source).graph.bearings).toHaveLength(1);
  });

  it("does not let a Bearing-as-Point use supply a linked target or redirect its sources outward", () => {
    const { graph } = compile("- [. @premise] Premise.\n- [C @claim] Claim.\n- [_ @premise +> @claim; @route]\n- [C @outer] Outer.\n  - [. use @route]\n    - [linked; @joint]\n      - [G @first] First.\n      - [G @second] Second.");
    expect(graph.bearings.map(bearing => bearing.handle)).toEqual(["route"]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["BEARING_IS_NOT_POINT_REFERENCE", "POINT_FOCUS_REQUIRES_POINT"]);
    expect(graph.points).toHaveLength(5);
  });

  it("retains valid focus and declaration identity while rejecting only a retired explicit attachment", () => {
    const { graph } = compile("- [. @premise] Original.\n- [C @claim] Claim.\n- [_ @premise +> @claim; @route]\n- [G use @premise _> @route]\n  - [O @child] Challenges premise.");
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "challenges"]);
    expect(graph.bearings[1].target).toEqual({ kind: "point", key: graph.points[0].key });
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["RETIRED_AUTHORING_SYNTAX"]);
    expect(graph.points).toHaveLength(3);
  });

  it.each(["[use @premise", "[G_", "[O_"])("retains unclosed retired %s as a failed boundary", header => {
    const { graph } = compile("- [. @premise] Original.\n- [C @outer] Outer.\n  - " + header + "\n    - [G @child] Valid child.\n      - [O] Own subtree.");
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["challenges"]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("MALFORMED_ANNOTATION_PREFIX");
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("RETIRED_AUTHORING_SYNTAX");
  });

  it("maps symbolic reuse in a BOM/CRLF host to original UTF-16 declaration and occurrence spans", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const host = "\uFEFF" + fence + "cog\r\n- [. @premise] 😀 Original.\r\n- [C @claim] Claim.\r\n  - [G use @premise; @step] 😀 Local prose.\r\n    - [O/] Assessment.\r\n" + fence;
    const result = explainSource(host, "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0].points[0].sourceSpan).toEqual({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 28 });
    expect(result.explanations[0].entries[2].sourceSpan.startLine).toBe(4);
    expect(result.explanations[0].entries[2].effects).toContainEqual({ kind: "focusPoint", operand: { id: "premise" }, ref: { kind: "point", key: result.graphs[0].points[0].key } });
  });

  it.each(["[Q/]", "[. . .]", "[. use]", "[. use @missing]", "[O/ use @missing /> @route]"])("keeps malformed %s distinct from ordinary bracket prose", header => {
    expect(codes("- " + header)).not.toEqual([]);
    expect(codes("- [...] Ordinary ellipsis.\n- [use case] Prose.\n- [.use] Prose.\n- [edgeless] Prose.")).toEqual([]);
  });
});
