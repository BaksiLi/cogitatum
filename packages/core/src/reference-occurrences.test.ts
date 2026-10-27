import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";
import type { GraphIR } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
const relations = (graph: GraphIR) => {
  const names = new Map([...graph.points.map(point => [point.key, point.id] as const), ...graph.bearings.map(bearing => [bearing.key, bearing.handle] as const)]);
  return graph.bearings.map(bearing => ({ kind: bearing.kind, handle: bearing.handle, sources: bearing.sources.map(ref => names.get(ref.key)), target: { kind: bearing.target.kind, name: names.get(bearing.target.key) } }));
};

describe("reference-only Point occurrences", () => {
  it.each(["C", "Q", "O", "R", "D", "G", ""])("preserves declaration %s while applying only the written G use mark", mark => {
    const declaration = mark ? mark + " @premise" : ". @premise";
    const source = "- [" + declaration + "] Original premise.\n- [C @claim] Open claim.\n  - [G use @premise; @step] Local occurrence prose.\n    - [O/ @objection; @attack] Assessment.";
    const { graph, explain } = compile(source);
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(3);
    expect(graph.points[0]).toMatchObject({ id: "premise", text: "Original premise.", declaration: { form: mark ? "role" : "material" } });
    expect(graph.points[0].declaration.role).toBe(mark || undefined);
    expect(relations(graph)).toEqual([
      { kind: "supports", handle: "step", sources: ["premise"], target: { kind: "point", name: "claim" } },
      { kind: "challenges", handle: "attack", sources: ["objection"], target: { kind: "bearing", name: "step" } }
    ]);
    expect(graph.bearings[0].text).toBeUndefined();
    expect(explain.entries[2].effects).toContainEqual({ kind: "focusPoint", operand: { id: "premise" }, ref: { kind: "point", key: graph.points[0].key } });
    expect(explain.entries[2].effects.some(effect => effect.kind === "emitPoint")).toBe(false);
  });

  it("keeps declaration and multiple local attachment identities distinct", () => {
    const source = "- [C @original] Original target.\n  - [G @premise; @original-step] Premise.\n- [C @first] First target.\n  - [G use @premise; @first-step]\n    - [O/ @first-objection] First assessment.\n- [C @second] Second target.\n  - [G use @premise; @second-step]\n    - [O/ @second-objection] Second assessment.\n- [edge @premise supports @original; @remote] Remote reuse.";
    const { graph } = compile(source);
    expect(codes(graph)).toEqual([]);
    expect(graph.points.filter(point => point.id === "premise")).toHaveLength(1);
    const names = relations(graph);
    expect(names.filter(bearing => bearing.kind === "challenges").map(bearing => bearing.target.name)).toEqual(["first-step", "second-step"]);
    expect(new Set(graph.bearings.map(bearing => bearing.key)).size).toBe(6);
  });

  it("bare use focuses without an attachment or inherited role, while child R still replies to it", () => {
    const { graph } = compile("- [O @objection] Original O.\n  - [G; @original-step] Original ground.\n- [C @claim] Claim.\n  - [. use @objection] Local prose.\n    - [R @bare-reply] No inherited O mark.\n    - [O/] No inherited attachment.\n- [O use @objection]\n  - [R @marked-reply] Local reply.");
    expect(codes(graph)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(relations(graph).filter(bearing => bearing.kind === "respondsTo")).toEqual([
      { kind: "respondsTo", handle: undefined, sources: ["bare-reply"], target: { kind: "point", name: "objection" } },
      { kind: "respondsTo", handle: undefined, sources: ["marked-reply"], target: { kind: "point", name: "objection" } }
    ]);
  });

  it("Q uses preserve declarations without turning Claim children into answers", () => {
    const { graph } = compile("- [Q @question] Original Q.\n- [C @claim] Original open claim.\n- [. use @question]\n  - [C @background] Not an answer.\n- [Q use @claim]\n  - [C @answer] Explicit local Q focus.");
    expect(codes(graph)).toEqual([]);
    expect(relations(graph)).toEqual([]);
    expect(graph.points.find(point => point.id === "claim")?.declaration.status).toBeUndefined();
  });

  it.each(["G use @premise", ". use @premise"])("allows a complete symbolic override for %s and exactly one attachment", mark => {
    const { graph } = compile("- [. @premise] Premise.\n- [C @outer] Outer.\n  - [" + mark + " ~> @topic; @step] Local description.\n    - [O/] Assessment.\n- [Q @topic] Topic.");
    expect(codes(graph)).toEqual([]);
    expect(relations(graph).map(bearing => [bearing.kind, bearing.target.name])).toEqual([["concerns", "topic"], ["challenges", "step"]]);
  });

  it.each([". use @missing", ". use @route", "C? use @premise", "G use @", "G use @premise answers", "O/ use @premise /> @route", ". use @premise; @dangling", ". use @premise", "Use @premise"])("retains %s failures without outer fallback or declaration", header => {
    const source = "- [C @claim] Claim.\n- [. @premise] Original.\n- [edge @premise +> @claim; @route]\n- [C @outer] Outer.\n  - [" + header + "] Local use.\n    - [O/] Must not guess an attachment.\n    - [G @child] Valid child.\n      - [O @grandchild] Valid subtree.";
    const { graph } = compile(source);
    expect(graph.points.map(point => point.id)).toEqual(["claim", "premise", "outer", undefined, "child", "grandchild"]);
    expect(graph.bearings.some(bearing => bearing.sources.some(ref => graph.points.find(point => point.key === ref.key)?.id === "child") && bearing.target.key === graph.points.find(point => point.id === "outer")?.key)).toBe(false);
    expect(codes(graph)).toContain("NO_LOCAL_BEARING_ATTACHMENT");
  });

  it.each(["[. use @premise", "[G use @premise", "[O/ use @premise"])("retains unclosed %s as a use boundary", header => {
    const { graph, explain } = compile("- [. @premise] Premise.\n- [C @outer] Outer.\n  - " + header + "\n    - [G @child] Child.");
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toContain("FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET");
    expect(explain.entries[2].recognition.kind).toBe("use");
  });

  it("requires a neutral use for linked membership regardless of declaration role", () => {
    const { graph } = compile("- [C @premise] Original C.\n- [. @other] Other material.\n- [C @claim] Claim.\n  - [_ G; @joint]\n    - [. use @premise]\n    - [. use @other]\n    - [O/ @objection] Assessment.");
    expect(codes(graph)).toEqual([]);
    expect(relations(graph)[0]).toEqual({ kind: "supports", handle: "joint", sources: ["premise", "other"], target: { kind: "point", name: "claim" } });
    expect(graph.points).toHaveLength(4);
    const bare = compile("- [G @premise] Original G.\n- [C @claim] Claim.\n  - [_ G]\n    - [.] Valid source.\n    - [G use @premise]").graph;
    expect(codes(bare)).toEqual(["INVALID_LOCAL_BEARING_MEMBER"]);
    expect(bare.bearings).toEqual([]);
  });

  it("rejects repeated resolved linked identity instead of deduplicating or inventing unary support", () => {
    for (const sources of ["    - [. use @premise]\n    - [. use @premise]", "    - [. @premise] Definition.\n    - [. use @premise]"]) {
      const declaration = sources.includes("[. @premise]") ? "" : "- [C @premise] Original.\n";
      const { graph } = compile(declaration + "- [C @claim] Claim.\n  - [_ G; @joint]\n" + sources + "\n    - [O/] Failed joint assessment.");
      expect(graph.bearings).toEqual([]);
      expect(codes(graph)).toEqual(["DUPLICATE_BEARING_SOURCES", "UNRESOLVED_BEARING_TARGET"]);
    }
  });

  it("rejects failed source focus atomically while independent target failure does not shrink a joint", () => {
    const failed = compile("- [. @premise] Premise.\n- [C @claim] Claim.\n  - [_ G]\n    - [. use @premise]\n    - [. use @missing]").graph;
    expect(failed.bearings).toEqual([]);
    expect(codes(failed)).toEqual(["UNKNOWN_POINT_REFERENCE", "UNKNOWN_SOURCE"]);
    const independent = compile("- [. @premise] Premise.\n- [C @claim] Claim.\n  - [_ G; @joint]\n    - [. use @premise]\n    - [G use @premise +> @missing]").graph;
    expect(codes(independent)).toEqual(["UNKNOWN_TARGET"]);
    expect(independent.bearings).toHaveLength(1);
  });

  it("preserves duplicate-declaration errors and rejects ambiguous focus", () => {
    const { graph } = compile("- [C @duplicate] First.\n- [G @duplicate] Second.\n- [G use @duplicate]");
    expect(graph.points).toEqual([]);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual(["DUPLICATE_ID", "INVALID_POINT_REFERENCE"]);
  });

  it("preserves reference effects under scoped standalone declaration reordering and remote-edge additions", () => {
    const definitions = ["- [C @premise] Original content.", "- [Q @topic] Topic."];
    const local = "- [C @claim] Claim.\n  - [G use @premise; @step]\n    - [O/ @objection; @attack] Objection.\n- [edge @premise concerns @topic; @remote] Remote.";
    const before = compile(definitions.join("\n") + "\n" + local).graph;
    const after = compile(local + "\n" + definitions.toReversed().join("\n")).graph;
    expect(codes(before)).toEqual([]);
    expect(codes(after)).toEqual([]);
    expect(relations(before)).toEqual(relations(after));
  });

  it("never copies a subtree and keeps occurrence prose/mappings separate from Point declaration spans", () => {
    const source = "- [C @premise] 😀 Original.\n  - [O @old] Original subtree.\n- Explanation before reuse.\n- [C @claim] Claim.\n  - [G use @premise; @later] 😀 Local prose.\n    - [O/ @new] Assessment.";
    const fence = String.fromCharCode(96).repeat(3);
    const result = explainSource("Intro.\r\n" + fence + "cog\r\n" + source.replaceAll("\n", "\r\n") + "\r\n" + fence, "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0].points).toHaveLength(4);
    expect(result.graphs[0].points[0].sourceSpan?.startLine).toBe(3);
    expect(result.explanations[0].entries[4].sourceSpan.startLine).toBe(7);
    expect(result.documents[0].blocks[2].children[0].text).toBe("😀 Local prose.");
    expect(result.graphs[0].points[0].text).toBe("😀 Original.");
    expect(result.graphs[0].bearings).toHaveLength(3);
  });

  it("keeps use prose ordinary and isolates identities between host units", () => {
    expect(compile("- [use case] Ordinary prose.").graph.diagnostics).toEqual([]);
    expect(parseDocument("- [use case] Ordinary prose.").blocks[0].annotation).toBeUndefined();
    const malformedMarkedUse = parseDocument("- [. use case] Malformed marked use.");
    expect(malformedMarkedUse.blocks[0].annotation).toMatchObject({ kind: "use", syntaxErrors: ["reference"] });
    expect(malformedMarkedUse.diagnostics.map(diagnostic => diagnostic.code)).toContain("MALFORMED_POINT_USE");
    const fence = String.fromCharCode(96).repeat(3);
    const result = explainSource([fence + "cog", "- [C @premise] First unit.", fence, fence + "cog", "- [. use @premise] Another unit.", fence].join("\n"), "host");
    expect(result.graphs[1].points).toEqual([]);
    expect(result.graphs[1].bearings).toEqual([]);
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["UNKNOWN_POINT_REFERENCE"]);
  });

  it("never lets a failed Bearing-as-Point use supply a legal Bearing target to implicit descendants", () => {
    const { graph } = compile("- [C @claim] Claim.\n- [. @premise] Premise.\n- [edge @premise +> @claim; @route]\n- [. use @route]\n  - [G @child] Must not support route.\n  - [Q @gap] Must not be about route.\n  - [G @independent +> @claim] Independent relation.");
    expect(codes(graph)).toEqual(["BEARING_IS_NOT_POINT_REFERENCE", "POINT_FOCUS_REQUIRES_POINT"]);
    expect(graph.bearings).toHaveLength(2);
    expect(graph.bearings.every(bearing => bearing.target.kind === "point")).toBe(true);
  });

  it.each(["G use @premise +>", "G use @premise; @", "O/ use @premise /> @route"])("retains valid focus when only the attachment fails: %s", header => {
    const { graph, explain } = compile("- [C @premise] Original.\n- [C @outer] Outer.\n  - [" + header + "] Local use.\n    - [O @child] Challenges the focused premise.\n    - [O/] No outward selection.");
    expect(relations(graph)).toEqual([{ kind: "challenges", handle: undefined, sources: ["child"], target: { kind: "point", name: "premise" } }]);
    expect(explain.entries[2].effects).toContainEqual({ kind: "focusPoint", operand: { id: "premise" }, ref: { kind: "point", key: graph.points[0].key } });
    expect(codes(graph)).toContain("NO_LOCAL_BEARING_ATTACHMENT");
  });

  it("keeps local and explicit projections equal while preserving separate prose, spans and derivation", () => {
    const declarations = "- [C @premise] Original open premise.\n- [C @claim] Conclusion.\n- [O @objection] Objection.\n- [R @reply] Reply.";
    const local = compile(declarations + "\n- Narrative in reader order.\n- [. use @claim] Later discussion.\n  - [G use @premise; @step] Occurrence prose.\n    - [O/ use @objection; @attack]\n      - [R use @reply; @response]");
    const explicit = compile(declarations + "\n- [edge @premise supports @claim; @step]\n- [edge @objection /> @step; @attack]\n- [edge @reply respondsTo @objection; @response]");
    expect(codes(local.graph)).toEqual([]);
    expect(codes(explicit.graph)).toEqual([]);
    expect(relations(local.graph)).toEqual(relations(explicit.graph));
    expect(local.graph.points).toEqual(explicit.graph.points);
    expect(local.graph.bearings.map(bearing => bearing.derivedBy)).toEqual(["structural", "structural", "structural"]);
    expect(explicit.graph.bearings.map(bearing => bearing.derivedBy)).toEqual(["operator", "operator", "operator"]);
    expect(local.graph.bearings[0].sourceSpan?.startLine).toBe(7);
    expect(explicit.graph.bearings[0].sourceSpan?.startLine).toBe(5);
    expect(local.explain.entries.filter(entry => entry.effects.some(effect => effect.kind === "focusPoint"))).toHaveLength(4);
    expect(explicit.explain.entries.some(entry => entry.effects.some(effect => effect.kind === "focusPoint"))).toBe(false);
  });
});
