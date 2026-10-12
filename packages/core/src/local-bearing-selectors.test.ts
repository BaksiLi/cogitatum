import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";
import type { GraphIR } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
const projection = (graph: GraphIR) => {
  const names = new Map([...graph.points.map(point => [point.key, point.id] as const), ...graph.bearings.map(bearing => [bearing.key, bearing.handle] as const)]);
  return {
    points: graph.points.map(({ key: _key, sourceSpan: _span, ...point }) => point),
    bearings: graph.bearings.map(({ key: _key, sourceSpan: _span, derivedBy: _origin, ...bearing }) => ({ ...bearing, sources: bearing.sources.map(ref => names.get(ref.key)), target: { kind: bearing.target.kind, name: names.get(bearing.target.key) } }))
  };
};

describe("local Bearing attachment selectors", () => {
  it("matches complete targets without losing declaration metadata, instances or ordered endpoints", () => {
    const prefix = "- [C @claim] Claim.\n  - [G @premise; @step] Premise.\n    - Narrative.\n";
    const suffix = "\n        - [R @reply] Reply.";
    const local = compile(prefix + "      - [G/ @warrant; @backing] Warrant.\n      - [O/ @objection; @attack] Objection." + suffix);
    const explicit = compile(prefix + "      - [G @warrant +> @step; @backing] Warrant.\n      - [O @objection /> @step; @attack] Objection." + suffix);
    expect(codes(local.graph)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY", "IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
    expect(codes(explicit.graph)).toEqual([]);
    expect(projection(local.graph)).toEqual(projection(explicit.graph));
    expect(local.graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "supports", "undercuts", "repliesTo"]);
    expect(local.explain.entries[4].effects).toContainEqual({ kind: "selectAttachment", ownerSpan: local.graph.points[1].sourceSpan, target: { kind: "bearing", key: local.graph.bearings[0].key } });
    expect(local.graph.bearings[1].derivedBy).toBe("structural");
    expect(explicit.graph.bearings[1].derivedBy).toBe("operator");
  });

  it.each(["G/", "O/"])("selects an unnamed about attachment for %s instead of inventing support", mark => {
    const { graph } = compile("- [C @outer] Outer.\n  - [G @reason ~> @topic] About another topic.\n    - [" + mark + "] Assessment.\n- [C @topic] Topic.");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["about", mark === "G/" ? "supports" : "undercuts"]);
    expect(graph.bearings[1].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
  });

  it("classifies linked sources, selectors and independent clauses once before lowering", () => {
    const { graph, explain } = compile("- [C @claim] Claim.\n  - [linked; @joint]\n    - [G @first] First.\n    - [G @second] Second.\n    - [G/ @warrant] Warrant.\n    - [O/ @objection] Objection.\n      - [R] Reply.\n    - [G @independent +> @missing] Independent invalid target.");
    expect(codes(graph)).toEqual(["UNKNOWN_TARGET"]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "supports", "undercuts", "repliesTo"]);
    expect(graph.bearings[0].sources.map(ref => graph.points.find(point => point.key === ref.key)?.id)).toEqual(["first", "second"]);
    expect(explain.entries.flatMap(entry => entry.effects.filter(effect => effect.kind === "linkedMember").map(effect => effect.function))).toEqual(["source", "source", "commentary", "commentary", "independent"]);
  });

  it.each(["[G +>]", "[G @missing @other]", "[G; @individual]", "[O]", "[linked]"])("rejects unclassified %s without reducing sources or restoring unary supports", header => {
    const { graph } = compile("- [C @claim] Claim.\n  - [linked; @joint]\n    - [G @first] First.\n    - " + header + " Invalid child.\n    - [G @second] Second.");
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toContain("INVALID_LINKED_MEMBER");
  });

  it.each(["[G/ +> @claim]", "[O/ @a @b]", "[G/;]", "[O/"])("retains malformed selector commentary %s without shrinking the joint", header => {
    const { graph } = compile("- [C @claim] Claim.\n  - [linked; @joint]\n    - [G @first] First.\n    - " + header + " Invalid commentary.\n      - [G @child] Descendant.\n    - [G @second] Second.");
    expect(graph.bearings.find(bearing => bearing.handle === "joint")?.sources.map(ref => graph.points.find(point => point.key === ref.key)?.id)).toEqual(["first", "second"]);
    expect(codes(graph)).not.toContain("INVALID_LINKED_MEMBER");
    expect(graph.bearings.filter(bearing => bearing.sources.some(ref => graph.points.find(point => point.key === ref.key)?.id === "first"))).toHaveLength(1);
  });

  it.each(["G/", "O/"])("does not invent a unary attachment for a linked member under %s", mark => {
    const { graph } = compile("- [C] Claim.\n  - [linked]\n    - [G] Member.\n      - [" + mark + "] Invalid member assessment.\n    - [G] Second.");
    expect(codes(graph)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].sources).toHaveLength(2);
  });

  it.each(["- [C] Root.\n  - [O/] No attachment.", "- [C] Root.\n  - [G] Ground.\n    - [C] Intervening Point.\n      - [G/] No attachment."])("never crosses an unattached Point boundary", source => {
    const { graph } = compile(source);
    expect(codes(graph)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(graph.bearings.filter(bearing => bearing.target.kind === "bearing")).toEqual([]);
  });

  it("propagates failed owned attachments instead of selecting an outer surviving relation", () => {
    const { graph } = compile("- [C @claim] Claim.\n  - [G @outer; @good] Good.\n    - [G @inner +> @missing; @bad] Invalid attachment.\n      - [O/] Invalid dependent.");
    expect(codes(graph)).toEqual(["UNKNOWN_TARGET", "UNRESOLVED_BEARING_TARGET"]);
    expect(graph.bearings.map(bearing => bearing.handle)).toEqual(["good"]);
  });

  it("rejects comments-only and failed constructors without outward fallback", () => {
    const { graph } = compile("- [C @claim] Claim.\n  - [linked]\n    - [G/] No sources.\n  - [edge]\n    - [O/] Failed edge.\n  - [G @independent +> @claim] Independent support.");
    expect(codes(graph)).toEqual(["MALFORMED_EDGE_ANNOTATION", "EMPTY_LINKED", "NO_LOCAL_BEARING_ATTACHMENT", "NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(graph.bearings).toHaveLength(1);
  });

  it("supports edge/body selection and recursive commentary but keeps unsuffixed edge defaults explicit", () => {
    const { graph } = compile("- [C @claim] Claim.\n- [G @reason] Reason.\n- [edge @reason +> @claim; @step]\n  - Body.\n    - [O/ @objection; @attack] Assessment.\n      - [G/] Ground for the attack.\n      - [R] Reply.\n  - [O] Still requires a target.");
    expect(codes(graph)).toEqual(["EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET", "IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "undercuts", "supports", "repliesTo"]);
    expect(graph.bearings[2].target.key).toBe(graph.bearings[1].key);
  });

  it("ignores remote edges and standalone declaration reordering for local ownership", () => {
    const local = "- [C @claim] Claim.\n  - [G @reason; @step] Reason.\n    - [O/ @objection; @attack] Assessment.";
    const remote = "- [C @other] Other.\n- [edge @reason +> @other; @remote] Remote reuse.";
    const before = compile(local + "\n" + remote).graph;
    const after = compile(remote + "\n" + local).graph;
    for (const graph of [before, after]) {
      expect(codes(graph)).toEqual([]);
      expect(graph.bearings.find(bearing => bearing.handle === "attack")?.target.key).toBe(graph.bearings.find(bearing => bearing.handle === "step")?.key);
    }
  });

  it.each(["Q_", "C_", "R_", "D_", "?_", "g_"])("diagnoses unsupported %s while retaining a failed boundary", mark => {
    const { graph } = compile("- [C] Outer.\n  - [" + mark + "] Invalid selector.\n    - [G] Descendant.");
    expect(codes(graph).length).toBeGreaterThan(0);
    expect(graph.bearings.some(bearing => bearing.target.key === graph.points[0].key)).toBe(false);
  });

  it("preserves original UTF-16 ownership and commentary spans in a selected host unit", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const source = ["Intro 😀.", "  " + fence + "cog", "  - [C @claim] Claim.", "    - [G @reason; @step] 😀 Ground.", "      - [O/] 😀 Assessment.", "  " + fence].join("\r\n");
    const result = explainSource(source, "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.explanations[0].entries[2].effects).toContainEqual({ kind: "selectAttachment", ownerSpan: result.graphs[0].points[1].sourceSpan, target: { kind: "bearing", key: result.graphs[0].bearings[0].key } });
    expect(result.graphs[0].bearings[1].sourceSpan).toEqual({ startLine: 5, startColumn: 9, endLine: 5, endColumn: 28 });
  });
});
