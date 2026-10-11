import { describe, expect, it } from "vitest";
import { compileGraph, compileGraphWithExplain, explainSource, parseAnnotation, parseDocument } from "./index.js";
import type { GraphIR } from "./types.js";

const compile = (source: string) => compileGraph(parseDocument(source));
const codes = (graph: GraphIR) => graph.diagnostics.map(d => d.code);

// Compare semantic content and topology, deliberately excluding compilation-local
// keys, order, locations, trace, and structural/operator provenance.
function normalize(graph: GraphIR) {
  const pointName = (key: string) => {
    const point = graph.points.find(p => p.key === key)!;
    return point.id ?? point.text;
  };
  const bearingName = (key: string) => graph.bearings.find(b => b.key === key)!.handle!;
  return {
    points: graph.points.map(({ key: _key, sourceSpan: _span, ...p }) => p)
      .sort((a, b) => (a.id ?? a.text).localeCompare(b.id ?? b.text)),
    bearings: graph.bearings.map(b => ({
      kind: b.kind, handle: b.handle, text: b.text,
      sources: b.sources.map(s => pointName(s.key)).sort(),
      target: { kind: b.target.kind, name: b.target.kind === "point" ? pointName(b.target.key) : bearingName(b.target.key) }
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  };
}

function routes(graph: GraphIR) {
  return normalize(graph).bearings.map(({ text: _text, ...b }) => b);
}

describe("local joint support", () => {
  it.each(["join", "join;", "join; @route", "join; @a; @b", "JOIN", "join @ref", "join +> @c", "join the debate"])("diagnoses retired %s through one rejection path", raw => {
    const parsed = parseAnnotation(raw);
    expect(parsed.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["RETIRED_JOIN_ANNOTATION"]);
    expect(parsed.annotation).toEqual({ kind: "linked", raw, syntaxErrors: ["linked"] });
  });

  it("leaves no retired route binding to collide with valid names", () => {
    const missing = compile("- [C @c] Conclusion.\n  - [join; @route]\n    - [G] Premise.\n- [O /> @route] Objection.");
    expect(codes(missing)).toEqual(["RETIRED_JOIN_ANNOTATION", "UNKNOWN_TARGET"]);
    const valid = compile("- [C @c] Conclusion.\n  - [join; @route]\n    - [G] Old premise.\n  - [linked; @route]\n    - [G] Current premise.\n- [O /> @route] Objection.");
    expect(codes(valid)).toEqual(["RETIRED_JOIN_ANNOTATION"]);
    expect(valid.bearings.map(bearing => bearing.kind)).toEqual(["supports", "undercuts"]);
    const pointName = compile("- [C @route] Conclusion.\n  - [join; @route]\n    - [G] Premise.");
    expect(codes(pointName)).toEqual(["RETIRED_JOIN_ANNOTATION"]);
  });

  it.each(["[join the debate]", "[linked evidence]"])("reserves annotation-shaped %s and keeps its failed boundary", header => {
    const graph = compile("- [C] Conclusion.\n  - " + header + " Context.\n    - [G] Reason.");
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual([header.startsWith("[join ") ? "RETIRED_JOIN_ANNOTATION" : "MALFORMED_LINKED_ANNOTATION"]);
  });

  it.each(["[join]", "[join; @route]", "[join;]", "[join; @a; @b]", "[Join]", "[join", "[ join", "[  JOIN; @route"])("rejects retired %s without retargeting its descendants", header => {
    const source = "- [C @c] Conclusion.\n  - " + header + "\n    - [G @a] Premise.\n      - [O] Premise objection.\n    - [G @b +> @c; @independent] Independent intent.";
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toContain("RETIRED_JOIN_ANNOTATION");
    expect(ast.blocks[0].children[0].annotation).toMatchObject({ kind: "linked", syntaxErrors: expect.arrayContaining(["linked"]) });
    expect(graph.points).toHaveLength(4);
    expect(graph.bearings).toHaveLength(2);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["challenges", "supports"]);
    expect(graph.bearings.find(bearing => bearing.handle === "independent")?.derivedBy).toBe("operator");
    expect(explain.entries[1].effects).toContainEqual({ kind: "rejectBearing", reason: "invalid-linked" });
    expect(explain.entries[2].effects).toContainEqual({ kind: "skipBearing", reason: "linked-membership" });
  });

  it("creates one structural joint without a synthetic Point or unary defaults", () => {
    const source = "- [C @c] Conclusion.\n  - [linked; @route] 說明這一步。\n    - [G @a] Same prose.\n    - [G @b] Same prose.";
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toEqual([]);
    expect(graph.points.map(p => [p.id, p.declaration.role, p.text])).toEqual([
      ["c", "C", "Conclusion."], ["a", "G", "Same prose."], ["b", "G", "Same prose."]
    ]);
    expect(routes(graph)).toEqual([{ kind: "supports", handle: "route", sources: ["a", "b"], target: { kind: "point", name: "c" } }]);
    expect(graph.bearings[0]).toMatchObject({ text: "說明這一步。", derivedBy: "structural", sourceSpan: ast.blocks[0].children[0].sourceSpan });
    expect(ast.blocks[0].children[0]).toMatchObject({ annotation: { kind: "linked", handle: "route" }, text: "說明這一步。", children: [{ text: "Same prose." }, { text: "Same prose." }] });
    expect(explain.entries[1]).toMatchObject({ recognition: { kind: "linked" }, effects: [{ kind: "emitBearing", reason: "linked-containment" }] });
    for (const entry of explain.entries.slice(2)) {
      expect(entry.effects).toContainEqual({ kind: "linkedMember", linkedSpan: ast.blocks[0].children[0].sourceSpan, eligible: true, function: "source" });
      expect(entry.effects).toContainEqual({ kind: "skipBearing", reason: "linked-membership" });
    }
  });

  it("keeps ordinary unary support, a joint, shared references, and premise/route objections separate", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [G @independent] Observation.
  - [linked; @route]
    - [G @a] Shared premise.
      - [O @premise-objection] Premise objection.
        - [R @reply] Reply.
    - [G @b] Other premise.
- [C @other] Other conclusion.
- [edge @a +> @other; @shared]
- [O @route-objection /> @route] Route objection.`);
    expect(codes(graph)).toEqual([]);
    expect(routes(graph)).toEqual(expect.arrayContaining([
      { kind: "supports", handle: "route", sources: ["a", "b"], target: { kind: "point", name: "c" } },
      { kind: "supports", handle: "shared", sources: ["a"], target: { kind: "point", name: "other" } },
      { kind: "challenges", handle: undefined, sources: ["premise-objection"], target: { kind: "point", name: "a" } },
      { kind: "repliesTo", handle: undefined, sources: ["reply"], target: { kind: "point", name: "premise-objection" } },
      { kind: "undercuts", handle: undefined, sources: ["route-objection"], target: { kind: "bearing", name: "route" } }
    ]));
    expect(graph.points.map(p => p.id)).toEqual(["c", "independent", "a", "premise-objection", "reply", "b", "other", "route-objection"]);
    expect(graph.bearings).toHaveLength(6);
  });

  it("allows a further joint below a real intermediate Ground, with ordinary body lookup", () => {
    const graph = compile(`- [C @c] Conclusion.
  - Context.
    - [linked; @outer]
      - [G @mid] Intermediate conclusion used as a Ground.
        - Explanation.
          - [linked; @inner]
            - [G @a] First premise.
            - [G @b] Second premise.
      - [G @other] Other premise.`);
    expect(codes(graph)).toEqual([]);
    expect(routes(graph)).toEqual([
      { kind: "supports", handle: "inner", sources: ["a", "b"], target: { kind: "point", name: "mid" } },
      { kind: "supports", handle: "outer", sources: ["mid", "other"], target: { kind: "point", name: "c" } }
    ]);
  });

  it("keeps a member's body and Gap separate from the joint's sources", () => {
    const ast = parseDocument(`- [C @c] The run can proceed.
  - [linked]
    - [G @calibration] The calibration passed.
      - Certificate checked at the bench.
      - [?] The certificate's validity period has not been checked.
    - [G @seal] The chamber is sealed.`);
    const graph = compileGraph(ast);
    expect(graph.diagnostics).toEqual([]);
    expect(ast.blocks[0].children[0].children[0].children[0]).toMatchObject({
      text: "Certificate checked at the bench.", children: []
    });
    expect(ast.blocks[0].children[0].children[0].children[0].annotation).toBeUndefined();
    expect(graph.points.map(p => [p.id, p.declaration.form, p.declaration.role, p.text])).toEqual([
      ["c", "role", "C", "The run can proceed."],
      ["calibration", "role", "G", "The calibration passed."],
      [undefined, "gap", undefined, "The certificate's validity period has not been checked."],
      ["seal", "role", "G", "The chamber is sealed."]
    ]);
    expect(graph.bearings.map(b => ({ kind: b.kind, sources: b.sources, target: b.target }))).toEqual([
      { kind: "supports", sources: [{ key: graph.points[1].key, kind: "point" }, { key: graph.points[3].key, kind: "point" }], target: { key: graph.points[0].key, kind: "point" } },
      { kind: "about", sources: [{ key: graph.points[2].key, kind: "point" }], target: { key: graph.points[1].key, kind: "point" } }
    ]);
  });

  it.each(["Q", "C?", "G", "O", "R", "D", "?", ". @target"])("targets the nearest %s Point", mark => {
    const graph = compile(`- [${mark}] Target.\n  - [linked; @route] Singleton route.\n    - [G] Premise.`);
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0]).toMatchObject({ handle: "route", text: "Singleton route.", sources: [{ key: graph.points[1].key, kind: "point" }], target: { key: graph.points[0].key, kind: "point" } });
  });

  it("accepts singleton and rejects empty/untargeted groups while retaining Points", () => {
    const empty = compile("- [C] Target.\n  - [linked; @route]\n- [O /> @route] Objection.");
    expect(empty.points).toHaveLength(2);
    expect(empty.bearings).toEqual([]);
    expect(codes(empty)).toEqual(["EMPTY_LINKED", "UNKNOWN_TARGET"]);
    const root = compile("- [linked]\n  - [G] Premise.");
    expect(root.points.map(p => p.text)).toEqual(["Premise."]);
    expect(root.bearings).toEqual([]);
    expect(codes(root)).toEqual(["LINKED_REQUIRES_POINT_TARGET"]);
  });

  it.each(["[linked; @a; @b]", "[linked;]", "[linked @ref]", "[Linked]", "[linked +> @c]", "[linked", "[ linked", "[  linked; @route"])("retains invalid construct %s without unary recovery", header => {
    const ast = parseDocument(`- [C @c] Conclusion.\n  - ${header}\n    - [G] Premise.`);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(ast.blocks[0].children[0].annotation?.kind).toBe("linked");
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.some(d => d.severity === "error")).toBe(true);
    expect(explain.entries[1].effects).toContainEqual({ kind: "rejectBearing", reason: "invalid-linked" });
    expect(explain.entries[2].effects).toContainEqual({ kind: "skipBearing", reason: "linked-membership" });
  });

  it("keeps anonymous sources distinct even when their prose is identical", () => {
    const graph = compile("- [C] Target.\n  - [linked]\n    - [G] Same.\n    - [G] Same.");
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(3);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0]).not.toHaveProperty("text");
    expect(graph.bearings[0].sources).toEqual(graph.points.slice(1).map(p => ({ key: p.key, kind: "point" })));
    expect(new Set(graph.bearings[0].sources.map(s => s.key)).size).toBe(2);
  });

  it("rejects malformed member operators without losing child reasoning or accepting the header note", () => {
    const member = compile("- [C] Target.\n  - [linked] Route description.\n    - [G +> @] Bad operator.\n      - [O] Premise objection.\n    - [G] Second.");
    expect(codes(member)).toEqual(["MALFORMED_BEARING_TARGETS", "INVALID_LINKED_MEMBER"]);
    expect(member.points.map(p => p.declaration.role)).toEqual(["C", "G", "O", "G"]);
    expect(member.bearings.map(b => b.kind)).toEqual(["challenges"]);
  });

  it("rejects invalid member atomically and preserves its reply subtree", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [linked; @route]
    - [G @a] Premise.
    - [O @o] Invalid direct objection.
      - [R @r] Reply.
- [O /> @route] Route objection.`);
    expect(graph.points.map(p => p.id)).toEqual(["c", "a", "o", "r", undefined]);
    expect(routes(graph)).toEqual([{ kind: "repliesTo", handle: undefined, sources: ["r"], target: { kind: "point", name: "o" } }]);
    expect(codes(graph)).toEqual(["INVALID_LINKED_MEMBER", "UNKNOWN_TARGET"]);
  });

  it.each(["C", "G; @member-route", "G;", "G?", "@ref"])("rejects direct %s atomically", mark => {
    const graph = compile(`- [C] Conclusion.\n  - [linked]\n    - [G] Good premise.\n    - [${mark}] Invalid member.`);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toContain("INVALID_LINKED_MEMBER");
  });

  it("rejects a direct Gap atomically without losing it or restoring unary support", () => {
    const graph = compile("- [C] Conclusion.\n  - [linked]\n    - [G] Good premise.\n    - [?] Invalid member.");
    expect(graph.points.map(p => [p.declaration.form, p.declaration.role, p.declaration.status, p.text])).toEqual([
      ["role", "C", undefined, "Conclusion."],
      ["role", "G", undefined, "Good premise."],
      ["gap", undefined, "open", "Invalid member."]
    ]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([{
      severity: "error", code: "INVALID_LINKED_MEMBER",
      message: "Direct linked children must be bare Ground sources, local selector commentary, or complete independent clauses.",
      sourceSpan: { startLine: 4, startColumn: 7, endLine: 4, endColumn: 26 }
    }]);
  });

  it("retains a complete operator as independent commentary alongside the joint", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [linked; @route] Rejected route description.
    - [G @a +> @other; @explicit] Explicit reason.
      - [O @o] Objection.
    - [G @b] Other premise.
- [C @other] Other target.`);
    expect(codes(graph)).toEqual([]);
    expect(routes(graph)).toEqual(expect.arrayContaining([
      { kind: "supports", handle: "route", sources: ["b"], target: { kind: "point", name: "c" } },
      { kind: "supports", handle: "explicit", sources: ["a"], target: { kind: "point", name: "other" } },
      { kind: "challenges", handle: undefined, sources: ["o"], target: { kind: "point", name: "a" } }
    ]));
    expect(graph.bearings).toHaveLength(3);
  });

  it("keeps a direct edge independent but never accepts it as a member", () => {
    const graph = compile("- [C @c] Conclusion.\n  - [linked]\n    - [G @a] Premise.\n    - [edge @a +> @c; @explicit]");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings.map(b => b.handle)).toEqual([undefined, "explicit"]);
  });

  it("rejects body-wrapped members without restoring unary support", () => {
    const { graph, explain } = compileGraphWithExplain(parseDocument(`- [C] Conclusion.
  - [linked] Header note does not make the wrapper a member.
    - Wrapper.
      - [G] Premise.
        - [O] Premise objection.`));
    expect(codes(graph)).toEqual(["INVALID_LINKED_MEMBER"]);
    expect(graph.points.map(p => p.declaration.role)).toEqual(["C", "G", "O"]);
    expect(graph.bearings.map(b => b.kind)).toEqual(["challenges"]);
    expect(explain.entries[3].effects).toContainEqual(expect.objectContaining({ kind: "linkedMember", eligible: false }));
  });

  it.each(["", "    - Wrapper.\n"])("rejects linked nesting across body %j", wrapper => {
    const nestedIndent = wrapper ? "      " : "    ";
    const graph = compile(`- [C] Conclusion.\n  - [linked]\n${wrapper}${nestedIndent}- [linked]\n${nestedIndent}  - [G] Premise.`);
    expect(codes(graph)).toEqual(["INVALID_LINKED_MEMBER", "NESTED_LINKED_UNSUPPORTED"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.points).toHaveLength(2);
  });

  it("preserves edge invalid-context diagnostics instead of using linked to bypass them", () => {
    const graph = compile(`- [C @c] Conclusion.
- [G @g] Ground.
- [edge @g +> @c]
  - Context.
    - [linked]
      - [G] Premise.
        - [O] Objection.`);
    expect(codes(graph)).toEqual(["LINKED_REQUIRES_POINT_TARGET", "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET"]);
    expect(graph.points).toHaveLength(4);
    expect(graph.bearings.map(b => b.kind)).toEqual(["supports", "challenges"]);
  });

  it("uses existing duplicate-name rejection for the entire source set and dependent routes", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [linked; @route]
    - [G @same] First.
    - [G @same] Second.
- [O /> @route] Objection.`);
    expect(graph.points.map(p => p.declaration.role)).toEqual(["C", "O"]);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual(["DUPLICATE_ID", "UNRESOLVED_BEARING_TARGET"]);
  });

  it("rejects colliding handles and wrong-kind references using the shared namespace", () => {
    const collision = compile("- [C @route] Conclusion.\n  - [linked; @route]\n    - [G] Premise.\n- [O /> @route] Objection.");
    expect(collision.points).toHaveLength(3);
    expect(collision.bearings).toEqual([]);
    expect(codes(collision)).toEqual(["POINT_BEARING_ID_CONFLICT"]);
    const badRefs = compile("- [C @c] Conclusion.\n  - [linked; @route]\n    - [G @a] Premise.\n- [edge @route +> @c]\n- [O -> @route] Wrong target.");
    expect(badRefs.bearings).toHaveLength(1);
    expect(codes(badRefs)).toEqual(["BEARING_IS_NOT_BEARING_SOURCE", "CHALLENGE_REQUIRES_POINT_TARGET"]);
    const duplicate = compile("- [C] Conclusion.\n  - [linked; @route]\n    - [G] First.\n  - [linked; @route]\n    - [G] Second.");
    expect(duplicate.points).toHaveLength(3);
    expect(duplicate.bearings).toEqual([]);
    expect(codes(duplicate)).toEqual(["DUPLICATE_BEARING_HANDLE"]);
  });

  it("adds no cycle policy to named routes", () => {
    const graph = compile("- [C @c] Conclusion.\n  - [linked; @route]\n    - [G @a] Premise.\n- [edge @a ~> @self; @self]");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings[1].target).toEqual({ key: graph.bearings[1].key, kind: "bearing" });
  });

  it("maps linked header and member locations to the host's one-based UTF-16 positions", () => {
    const source = "Intro.\n  ```cog\n  - [C @c] 😀 Target.\n    - [linked; @route] 😀 說明這一步。\n      - [G @a] 😀 Premise.\n      - [G @b] Second.\n  ```";
    const result = explainSource(source, "host");
    const graph = result.graphs[0];
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings[0].text).toBe("😀 說明這一步。");
    expect(graph.bearings[0].sourceSpan).toEqual({ startLine: 4, endLine: 4, startColumn: 7, endColumn: source.split("\n")[3].length + 1 });
    expect(graph.bearings[0].sourceSpan!.endColumn).toBe(33);
    expect(graph.points[1].sourceSpan).toEqual({ startLine: 5, endLine: 5, startColumn: 9, endColumn: source.split("\n")[4].length + 1 });
    expect(result.explanations[0].entries[2].effects).toContainEqual({ kind: "linkedMember", linkedSpan: graph.bearings[0].sourceSpan, eligible: true, function: "source" });
  });

  it("matches normalized edge topology while retaining Point role, form, status, content, and names", () => {
    const linked = compile("- [C? @c] Conclusion.\n  - [linked; @route] 說明這一步。\n    - [G @a] First.\n      - [O @o] Objection.\n        - [R @r] Reply.\n    - [G @b] Second.\n- [O @u /> @route] Undercut.");
    const edge = compile("- [C? @c] Conclusion.\n- [G @a] First.\n  - [O @o] Objection.\n    - [R @r] Reply.\n- [G @b] Second.\n- [edge @a, @b +> @c; @route] 說明這一步。\n- [O @u /> @route] Undercut.");
    expect(codes(linked)).toEqual([]);
    expect(codes(edge)).toEqual([]);
    expect(linked.bearings.find(b => b.handle === "route")?.text).toBe("說明這一步。");
    expect(normalize(linked)).toEqual(normalize(edge));
  });

  it.each(["[joining the discussion]", "[joined]", "[linking]", "[linked-data]"])("keeps ordinary G siblings unary through %s body", header => {
    const graph = compile("- [C] Conclusion.\n  - " + header + " Context.\n    - [G] First.\n    - [G] Second.");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings.map(b => b.sources.length)).toEqual([1, 1]);
    const ast = parseDocument("  - [linked");
    expect(ast.blocks[0].annotation).toBeUndefined();
    expect(ast.diagnostics.map(d => d.code)).toEqual(["INDENTED_ROOT_UNSUPPORTED"]);
  });
});
