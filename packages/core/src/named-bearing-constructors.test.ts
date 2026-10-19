import { describe, expect, it } from "vitest";
import { compileGraph, compileGraphWithExplain, compileSource, parseDocument } from "./index.js";
import type { BearingKind, GraphIR } from "./types.js";

const compile = (source: string) => compileGraph(parseDocument(source));
const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
const declarations = "- [. @first] Material premise.\n- [Q @second] A clarification question.\n- [C @target] Open claim.\n- [edge @target +> @first; @base] Base route.";
const kinds: (BearingKind | "undercuts")[] = ["supports", "challenges", "undercuts", "about", "answers", "repliesTo", "clarifies"];

describe("named canonical Bearing constructors", () => {
  it.each(kinds)("constructs ordered %s with existing Point identities and declaration metadata", kind => {
    const target = kind === "undercuts" ? "base" : "target";
    const source = declarations + "\n- [edge @second, @first " + kind + " @" + target + "; @named] Description mentions repliesTo without another clause.";
    const { graph, explain } = compileGraphWithExplain(parseDocument(source));
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(3);
    expect(graph.points.map(point => [point.id, point.declaration.form, point.declaration.role, point.declaration.status])).toEqual([
      ["first", "material", undefined, undefined], ["second", "role", "Q", undefined], ["target", "role", "C", undefined]
    ]);
    const bearing = graph.bearings.find(entry => entry.handle === "named")!;
    expect(bearing.kind).toBe(kind === "undercuts" ? "challenges" : kind);
    expect(bearing.sources.map(ref => graph.points.find(point => point.key === ref.key)?.id)).toEqual(["second", "first"]);
    expect(bearing.target.kind).toBe(kind === "undercuts" ? "bearing" : "point");
    expect(bearing.text).toBe("Description mentions repliesTo without another clause.");
    expect(bearing.derivedBy).toBe("operator");
    expect(explain.entries[4].effects).toContainEqual(expect.objectContaining({ kind: "emitBearing", reason: "operator-clause", bearing: expect.objectContaining({ kind: kind === "undercuts" ? "challenges" : kind }) }));
  });

  it.each(["supports", "challenges", "about"])("allows named %s to target an existing Bearing", kind => {
    const graph = compile(declarations + "\n- [edge @second " + kind + " @base]");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings[1]).toMatchObject({ kind, target: { key: graph.bearings[0].key, kind: "bearing" } });
  });

  it.each(["answers", "repliesTo", "clarifies"])("retains the Point target constraint for named %s", kind => {
    const graph = compile(declarations + "\n- [edge @first " + kind + " @base; @rejected]");
    expect(graph.bearings).toHaveLength(1);
    expect(codes(graph)).toEqual(["BEARING_KIND_REQUIRES_POINT_TARGET"]);
  });

  it("retains the Bearing target constraint for undercuts and existing symbolic />", () => {
    const named = compile(declarations + "\n- [edge @first undercuts @target]");
    const symbolic = compile(declarations + "\n- [edge @first /> @target]");
    expect(codes(named)).toEqual(["UNDERCUT_REQUIRES_BEARING_TARGET"]);
    expect(codes(symbolic)).toEqual(codes(named));
    expect(named.bearings).toHaveLength(1);
  });

  it.each([
    "[edge @first answer @target]", "[edge @first Answers @target]", "[edge @first repliesto @target]",
    "[edge @first constructor @target]", "[edge @first __proto__ @target]",
    "[edge answers @target]", "[edge @first answers]", "[edge @first, @first answers @target]",
    "[edge @first, @missing answers @target]", "[edge @first answers @missing]",
    "[edge @first answers @target, @second]", "[edge @first answers @target clarifies @second]",
    "[edge @first +> @target answers @second]", "[Edge @first answers @target]",
    "[edge @first answers @target"
  ])("fails %s without reduced sources or descendant fallback", header => {
    const graph = compile(declarations + "\n- [C] Outer context.\n  - " + header + "\n    - [G] Descendant content.");
    expect(graph.points).toHaveLength(5);
    expect(graph.bearings).toHaveLength(1);
    expect(codes(graph).length).toBeGreaterThan(0);
    expect(codes(graph)).toContain("EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET");
  });

  it("does not add named-kind clauses to self-sourced Point syntax", () => {
    const graph = compile("- [O @objection] Objection.\n- [Q @question repliesTo @objection] Unsupported attached form.");
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual(["MALFORMED_ROLE_ANNOTATION"]);
  });

  it("preserves a Question reply and a concession without converting either into a challenge", () => {
    const graph = compile("- [O @objection] The account lacks a time scale.\n- [Q @question] Which time scale do you mean?\n- [C @concession] The timing is uncertain.\n- [edge @question repliesTo @objection; @clarification]\n- [edge @concession repliesTo @objection; @conceding]");
    expect(codes(graph)).toEqual([]);
    expect(graph.points.map(point => point.declaration.role)).toEqual(["O", "Q", "C"]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["repliesTo", "repliesTo"]);
  });

  it("keeps forward reference effects under scoped declaration reordering and retains equal-endpoint instances", () => {
    const relations = "- [edge @first, @second answers @target; @one]\n- [edge @first, @second answers @target; @two]";
    const points = ["- [. @first] Same text.", "- [Q @second] Same text.", "- [C @target] Conclusion."];
    const summarize = (graph: GraphIR) => graph.bearings.map(bearing => ({
      handle: bearing.handle, kind: bearing.kind,
      sources: bearing.sources.map(ref => graph.points.find(point => point.key === ref.key)?.id),
      target: graph.points.find(point => point.key === bearing.target.key)?.id
    }));
    const before = compile(relations + "\n" + points.join("\n"));
    const after = compile(points.toReversed().join("\n") + "\n" + relations);
    expect(codes(before)).toEqual([]);
    expect(codes(after)).toEqual([]);
    expect(summarize(before)).toEqual(summarize(after));
    expect(before.bearings[0].key).not.toBe(before.bearings[1].key);
    expect(before.points[0].key).not.toBe(before.points[1].key);
  });

  it("propagates failed Bearing dependencies while retaining valid unrelated structure", () => {
    const graph = compile(declarations + "\n- [edge @first supports @missing; @failed]\n- [edge @second about @failed; @dependent]\n- [edge @second clarifies @target; @independent]");
    expect(codes(graph)).toEqual(["UNKNOWN_TARGET", "UNRESOLVED_BEARING_TARGET"]);
    expect(graph.bearings.map(bearing => bearing.handle)).toEqual(["base", "independent"]);
  });

  it("preserves the existing cycle policy and host namespace isolation", () => {
    const cycle = compile(declarations + "\n- [edge @first about @right; @left]\n- [edge @second supports @left; @right]");
    expect(codes(cycle)).toEqual([]);
    expect(cycle.bearings).toHaveLength(3);
    const fence = String.fromCharCode(96).repeat(3);
    const host = compileSource([fence + "cog", "- [O @remote] Remote objection.", fence, "", fence + "cog", "- [Q @local] Local question.", "- [edge @local repliesTo @remote]", fence].join("\n"), "host");
    expect(host.graphs[0].points).toHaveLength(1);
    expect(host.graphs[1].points).toHaveLength(1);
    expect(host.graphs[1].bearings).toEqual([]);
    expect(host.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["UNKNOWN_TARGET"]);
  });
});
