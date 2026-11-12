import { describe, expect, it } from "vitest";
import { compareCommitments, entailment, explainSource, formatExplain, formatGraph, graphCommitments, previewRelationEdit, previewTargetForm, suggestCorrespondence } from "./index.js";

const compile = (source: string) => {
  const compiled = explainSource(source);
  return { compiled, graph: compiled.graphs[0], codes: compiled.diagnostics.map(d => d.code) };
};
const base = "- [C @claim] 公共交通應該免費。\n- [. @p] 去年展會免費接駁。\n- [. @q] 塔林的實驗。\n";

describe("by example qualifies a constructed supports Bearing", () => {
  it.each([
    ["- [. @x +> @claim by example] 例子。", ["x"], "operator"],
    ["- [C @host] 宿主。\n  - [. @x supports ^ by example; @route] 例子。", ["x"], "structural"],
    ["- [. use @p +> @claim by example]", ["p"], "operator"],
    ["- [_ @p, @q +> @claim by example] 合起來是一個例子。", ["p", "q"], "operator"],
    ["- [C @host] 宿主。\n  - [G @x by example] 例子。", ["x"], "structural"],
    ["- [C @host] 宿主。\n  - [G use @p by example; @route]", ["p"], "structural"],
    ["- [C @host] 宿主。\n  - [_ +> ^ by example; @route]\n    - [. use @p]\n    - [. use @q]", ["p", "q"], "structural"]
  ])("%s", (source, sources, derivedBy) => {
    const { graph, codes } = compile(base + source);
    expect(codes).toEqual([]);
    const profiled = graph.bearings.filter(b => b.profile);
    expect(profiled).toHaveLength(1);
    expect(profiled[0]).toMatchObject({ kind: "supports", profile: "example", derivedBy });
    expect(profiled[0].sources.map(s => graph.points.find(p => p.key === s.key)?.id)).toEqual(sources);
    // The profile belongs to the Bearing: no Point records it.
    expect(JSON.stringify(graph.points)).not.toContain("example");
  });

  it("qualifies support to the exposed Bearing through ^/ and G/", () => {
    const source = "- [C @c] 主張。\n  - [G @g; @step] 理由。\n    - [. @x +> ^/ by example] 例子一。\n    - [G/ @y by example; @route] 例子二。\n    - [G/ use @x by example]";
    const { graph, codes } = compile(source);
    expect(codes).toEqual([]);
    expect(graph.bearings.filter(b => b.profile).map(b => b.target.kind)).toEqual(["bearing", "bearing", "bearing"]);
  });

  it("reads back in graph and Explain text", () => {
    const { compiled, graph } = compile(base + "- [. use @p +> @claim by example; @route]");
    expect(formatGraph(graph)).toContain('supports([p2], p1) profile="example" handle="route"');
    expect(formatExplain(compiled)).toContain("supports by example([");
  });

  it("does not transfer through Point reuse, and a Bearing use presents the same profile", () => {
    const { graph, codes } = compile(base + "- [. use @p +> @claim by example; @route]\n- [. use @p +> @claim]\n- [_ use @route]\n  - [O/ @o] 這個例子不具代表性。");
    expect(codes).toEqual([]);
    expect(graph.bearings.map(b => [b.kind, b.profile])).toEqual([["supports", "example"], ["supports", undefined], ["challenges", undefined]]);
  });
});

describe("a profile request without a support fails as a whole", () => {
  it.each([
    ["root G", "- [G @x by example] 例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["G beneath a Question", "- [Q @q] 應免費嗎？\n  - [G @x by example] 例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["G beneath a Question use, across body", "- [C @q] 某點。\n- [Q use @q]\n  - 備忘\n    - [G @x by example] 例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["neutral default", "- [C @c] 主張。\n  - [. @x by example] 例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["candidate answer", "- [Q @q] 應免費嗎？\n  - [C @x by example] 例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["objection", "- [C @c] 主張。\n  - [O @x by example] 反例。", "PROFILE_REQUIRES_SUPPORTS"],
    ["challenge clause", "- [C @c] 主張。\n- [. @x -> @c by example] 反例。", "PROFILE_REQUIRES_SUPPORTS"],
    ["interprets clause", "- [C @c] 主張。\n- [D @x interprets @c by example] 說明用的例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["O/ selector", "- [C @c] 主張。\n  - [G @g] 理由。\n    - [O/ @x by example] 反例。", "PROFILE_REQUIRES_SUPPORTS"],
    ["joint relevance", "- [C @c] 主張。\n  - [_ by example]\n    - [. @x] 例子。", "PROFILE_REQUIRES_SUPPORTS"],
    ["unknown profile", "- [C @c] 主張。\n  - [G @x by analogy] 類比。", "MALFORMED_BEARING_PROFILE"],
    ["missing profile name", "- [C @c] 主張。\n  - [G @x by] 例子。", "MALFORMED_BEARING_PROFILE"],
    ["profile after the handle", "- [C @c] 主張。\n  - [G @x; @r by example] 例子。", "MALFORMED_BEARING_HANDLE"]
  ])("%s", (_label, source, code) => {
    const { graph, codes } = compile(source);
    expect(codes).toContain(code);
    // The Point material is kept; neither an unprofiled nor a weaker Bearing replaces the request.
    expect(graph.points.some(p => p.id === "x")).toBe(true);
    expect(graph.bearings.filter(b => b.sources.some(s => s.key === graph.points.find(p => p.id === "x")!.key))).toEqual([]);
    expect(JSON.stringify(graph)).not.toContain('"profile"');
  });

  it("a Bearing use cannot add a profile to the Bearing it presents", () => {
    const { graph, codes } = compile("- [C @c] 主張。\n  - [G @x; @r] 理由。\n- [_ use @r by example]");
    expect(codes).toContain("PROFILE_REQUIRES_SUPPORTS");
    expect(graph.bearings).toEqual([expect.not.objectContaining({ profile: expect.anything() })]);
  });

  it("supports the Question itself only when written explicitly", () => {
    const { graph, codes } = compile("- [Q @q] 應免費嗎？\n  - [G @x +> ^ by example] 例子。");
    expect(codes).toEqual([]);
    expect(graph.bearings).toEqual([expect.objectContaining({ kind: "supports", profile: "example" })]);
  });

  it("the first G in a Bearing context still needs an explicit target; the modifier supplies none", () => {
    const { graph, codes } = compile("- [C @a] 甲。\n- [C @b] 乙。\n- [_ @a +> @b]\n  - [G @x by example] 例子。");
    expect(codes).toEqual(["EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"]);
    expect(graph.bearings).toHaveLength(1);
  });

  it("[G by example] beneath a neutral use ignores the declaration mark of the reused Point", () => {
    const { graph, codes } = compile("- [Q @q] 應免費嗎？\n- [. use @q]\n  - [G @x by example] 例子。");
    expect(codes).toEqual([]);
    expect(graph.bearings).toEqual([expect.objectContaining({ kind: "supports", profile: "example" })]);
  });
});

describe("refinement and comparison", () => {
  const plain = "- [C @c] 主張。\n- [. @x +> @c; @r] 例子。";
  const profiled = "- [C @c] 主張。\n- [. @x +> @c by example; @r] 例子。";

  it("example support entails plain support, not conversely, and relevance still follows", () => {
    const stated = graphCommitments(compile(profiled).graph);
    const { sources, target } = stated[0];
    expect(stated[0].profile).toBe("example");
    expect(entailment(stated, { kind: "supports", sources, target })).toEqual([stated[0]]);
    expect(entailment(stated, { kind: "concerns", sources, target })).toEqual([stated[0]]);
    expect(entailment(graphCommitments(compile(plain).graph), { kind: "supports", profile: "example", sources, target })).toBeUndefined();
  });

  it("adding the profile refines; forgetting it weakens to the underlying support", () => {
    const [a, b] = [compile(plain).graph, compile(profiled).graph];
    const forward = compareCommitments(a, b, suggestCorrespondence(a, b).correspondence);
    expect(forward).toMatchObject({ status: "compared", relation: "refinement", retracted: [], bearings: { changed: [{ profile: true }] } });
    const backward = compareCommitments(b, a, suggestCorrespondence(b, a).correspondence);
    expect(backward).toMatchObject({ status: "compared", relation: "weakening", added: [], bearings: { changed: [{ profile: true }] } });
  });

  it("reports a per-Bearing profile change even when the aggregate commitments are equivalent", () => {
    const parallel = "\n- [. use @x +> @c by example; @other]";
    const [a, b] = [compile(plain + parallel).graph, compile(profiled + parallel).graph];
    const comparison = compareCommitments(a, b, suggestCorrespondence(a, b).correspondence);
    expect(comparison).toMatchObject({ status: "compared", relation: "equivalent", added: [], retracted: [] });
    expect(comparison.status === "compared" && comparison.bearings.changed).toEqual([{ before: a.bearings[0].key, after: b.bearings[0].key, profile: true }]);
  });
});

describe("checked edits keep or refuse a profile, never drop it", () => {
  it("preserves the profile when a target is named or made positional", () => {
    const positional = "- [C @c] 主張。\n  - [G @x by example; @r] 例子。";
    const named = previewTargetForm(positional, { line: 2, form: "named" });
    expect(named).toMatchObject({ status: "ready", proposedSource: "- [C @c] 主張。\n  - [G @x +> @c by example; @r] 例子。" });
    const back = previewTargetForm((named as { proposedSource: string }).proposedSource, { line: 2, form: "positional" });
    expect(back).toMatchObject({ status: "ready", proposedSource: positional });
  });

  it.each([
    ["decide", { operation: "decide", line: 2, kind: "challenges" } as const],
    ["join", { operation: "join", lines: [2, 3] } as const]
  ])("refuses to %s a profiled relation", (_label, edit) => {
    const source = "- [C @c] 主張。\n  - [G @x by example] 例子一。\n  - [G @y by example] 例子二。";
    expect(previewRelationEdit(source, edit)).toMatchObject({ status: "unavailable", reason: "profiled-relation" });
  });

  it("refuses to separate a joint example", () => {
    const source = "- [C @c] 主張。\n  - [_ +> ^ by example]\n    - [. @x] 例子的一半。\n    - [. @y] 例子的另一半。";
    expect(previewRelationEdit(source, { operation: "separate", line: 2 })).toMatchObject({ status: "unavailable", reason: "profiled-relation" });
  });
});
