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
    expect(parsed.annotation).toEqual({ kind: "bearing", members: true, raw, syntaxErrors: ["retired"] });
  });

  it("leaves no retired route binding to collide with valid names", () => {
    const missing = compile("- [C @c] Conclusion.\n  - [join; @route]\n    - [G] Premise.\n- [O -> @route] Objection.");
    expect(codes(missing)).toEqual(["RETIRED_JOIN_ANNOTATION", "UNKNOWN_TARGET"]);
    const valid = compile("- [C @c] Conclusion.\n  - [join; @route]\n    - [G] Old premise.\n  - [_ +> ^; @route]\n    - [.] Current premise.\n- [O -> @route] Objection.");
    expect(codes(valid)).toEqual(["RETIRED_JOIN_ANNOTATION"]);
    expect(valid.bearings.map(bearing => bearing.kind)).toEqual(["supports", "challenges"]);
    const pointName = compile("- [C @route] Conclusion.\n  - [join; @route]\n    - [G] Premise.");
    expect(codes(pointName)).toEqual(["RETIRED_JOIN_ANNOTATION"]);
  });

  it.each(["[join the debate]", "[linked evidence]"])("reserves annotation-shaped %s and keeps its failed boundary", header => {
    const graph = compile("- [C] Conclusion.\n  - " + header + " Context.\n    - [G] Reason.");
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual([header.startsWith("[join ") ? "RETIRED_JOIN_ANNOTATION" : "RETIRED_LINKED_ANNOTATION"]);
  });

  it.each(["[join]", "[join; @route]", "[join;]", "[join; @a; @b]", "[Join]", "[join", "[ join", "[  JOIN; @route"])("rejects retired %s without retargeting its descendants", header => {
    const source = "- [C @c] Conclusion.\n  - " + header + "\n    - [G @a] Premise.\n      - [O] Premise objection.\n    - [G @b +> @c; @independent] Independent intent.";
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toContain("RETIRED_JOIN_ANNOTATION");
    expect(ast.blocks[0].children[0].annotation).toMatchObject({ kind: "bearing", members: true });
    expect(graph.points).toHaveLength(4);
    expect(graph.bearings).toHaveLength(2);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["challenges", "supports"]);
    expect(graph.bearings.find(bearing => bearing.handle === "independent")?.derivedBy).toBe("operator");
    expect(explain.entries[1].effects).toContainEqual({ kind: "rejectBearing", reason: "invalid-local-bearing" });
    expect(explain.entries[2].effects).toContainEqual({ kind: "skipBearing", reason: "local-bearing-membership" });
  });

  it("creates one structural joint without a synthetic Point or unary defaults", () => {
    const source = "- [C @c] Conclusion.\n  - [_ +> ^; @route] 說明這一步。\n    - [. @a] Same prose.\n    - [. @b] Same prose.";
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(codes(graph)).toEqual([]);
    expect(graph.points.map(p => [p.id, p.declaration.role, p.text])).toEqual([
      ["c", "C", "Conclusion."], ["a", undefined, "Same prose."], ["b", undefined, "Same prose."]
    ]);
    expect(routes(graph)).toEqual([{ kind: "supports", handle: "route", sources: ["a", "b"], target: { kind: "point", name: "c" } }]);
    expect(graph.bearings[0]).toMatchObject({ text: "說明這一步。", derivedBy: "structural", sourceSpan: ast.blocks[0].children[0].sourceSpan });
    expect(ast.blocks[0].children[0]).toMatchObject({ annotation: { kind: "bearing", members: true, handle: "route" }, text: "說明這一步。", children: [{ text: "Same prose." }, { text: "Same prose." }] });
    expect(explain.entries[1]).toMatchObject({ recognition: { kind: "bearing", members: true }, effects: [
      { kind: "attachNote", note: { origin: "constructor-description", target: { kind: "bearing", key: graph.bearings[0].key }, sourceSpan: ast.blocks[0].children[0].sourceSpan } },
      { kind: "implicitAttachment", contextSpan: ast.blocks[0].sourceSpan, crossedBodySpans: [] },
      { kind: "emitBearing", reason: "local-bearing-containment" }
    ] });
    for (const entry of explain.entries.slice(2)) {
      expect(entry.effects).toContainEqual({ kind: "localBearingMember", localBearingSpan: ast.blocks[0].children[0].sourceSpan, eligible: true, function: "source" });
      expect(entry.effects).toContainEqual({ kind: "skipBearing", reason: "local-bearing-membership" });
    }
  });

  it("keeps ordinary unary support, a joint, shared references, and premise/route objections separate", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [G @independent] Observation.
  - [_ +> ^; @route]
    - [. @a] Shared premise.
      - [O @premise-objection] Premise objection.
        - [R @reply] Reply.
    - [. @b] Other premise.
- [C @other] Other conclusion.
- [edge @a +> @other; @shared]
- [O @route-objection -> @route] Route objection.`);
    expect(codes(graph)).toEqual([]);
    expect(routes(graph)).toEqual(expect.arrayContaining([
      { kind: "supports", handle: "route", sources: ["a", "b"], target: { kind: "point", name: "c" } },
      { kind: "supports", handle: "shared", sources: ["a"], target: { kind: "point", name: "other" } },
      { kind: "challenges", handle: undefined, sources: ["premise-objection"], target: { kind: "point", name: "a" } },
      { kind: "respondsTo", handle: undefined, sources: ["reply"], target: { kind: "point", name: "premise-objection" } },
      { kind: "challenges", handle: undefined, sources: ["route-objection"], target: { kind: "bearing", name: "route" } }
    ]));
    expect(graph.points.map(p => p.id)).toEqual(["c", "independent", "a", "premise-objection", "reply", "b", "other", "route-objection"]);
    expect(graph.bearings).toHaveLength(6);
  });

  it("allows a further joint below a real intermediate Ground, with ordinary body lookup", () => {
    const graph = compile(`- [C @c] Conclusion.
  - Context.
    - [_ +> ^; @outer]
      - [. @mid] Intermediate conclusion used as a Ground.
        - Explanation.
          - [_ +> ^; @inner]
            - [. @a] First premise.
            - [. @b] Second premise.
      - [. @other] Other premise.`);
    expect(codes(graph)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY", "IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
    expect(routes(graph)).toEqual([
      { kind: "supports", handle: "inner", sources: ["a", "b"], target: { kind: "point", name: "mid" } },
      { kind: "supports", handle: "outer", sources: ["mid", "other"], target: { kind: "point", name: "c" } }
    ]);
  });

  it("keeps a member's body and Question separate from the joint's sources", () => {
    // The Question concerns its own member Point; it neither joins nor addresses the joint.
    const ast = parseDocument(`- [C @c] The run can proceed.
  - [_ +> ^]
    - [. @calibration] The calibration passed.
      - Certificate checked at the bench.
      - [Q] Is the certificate still valid?
    - [. @seal] The chamber is sealed.`);
    const graph = compileGraph(ast);
    expect(graph.diagnostics).toEqual([]);
    expect(ast.blocks[0].children[0].children[0].children[0]).toMatchObject({
      text: "Certificate checked at the bench.", children: []
    });
    expect(ast.blocks[0].children[0].children[0].children[0].annotation).toBeUndefined();
    expect(graph.points.map(p => [p.id, p.declaration.form, p.declaration.role, p.text])).toEqual([
      ["c", "role", "C", "The run can proceed."],
      ["calibration", "material", undefined, "The calibration passed."],
      [undefined, "role", "Q", "Is the certificate still valid?"],
      ["seal", "material", undefined, "The chamber is sealed."]
    ]);
    expect(graph.bearings.map(b => ({ kind: b.kind, sources: b.sources, target: b.target }))).toEqual([
      { kind: "supports", sources: [{ key: graph.points[1].key, kind: "point" }, { key: graph.points[3].key, kind: "point" }], target: { key: graph.points[0].key, kind: "point" } },
      { kind: "concerns", sources: [{ key: graph.points[2].key, kind: "point" }], target: { key: graph.points[1].key, kind: "point" } }
    ]);
  });

  it.each(["Q", "C", "G", "O", "R", "D", ". @target"])("targets the nearest %s Point", mark => {
    const graph = compile(`- [${mark}] Target.
  - [_ +> ^; @route] Singleton route.
    - [.] Premise.`);
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0]).toMatchObject({ handle: "route", text: "Singleton route.", sources: [{ key: graph.points[1].key, kind: "point" }], target: { key: graph.points[0].key, kind: "point" } });
  });

  it("accepts singleton and rejects empty/untargeted groups while retaining Points", () => {
    const empty = compile("- [C] Target.\n  - [_ +> ^; @route]\n- [O -> @route] Objection.");
    expect(empty.points).toHaveLength(2);
    expect(empty.bearings).toEqual([]);
    expect(codes(empty)).toEqual(["EMPTY_LOCAL_BEARING", "UNKNOWN_TARGET"]);
    const root = compile("- [_ +> ^]\n  - [.] Premise.");
    expect(root.points.map(p => p.text)).toEqual(["Premise."]);
    expect(root.bearings).toEqual([]);
    expect(codes(root)).toEqual(["LOCAL_BEARING_REQUIRES_POINT_TARGET"]);
  });

  it.each(["[linked; @a; @b]", "[linked;]", "[linked @ref]", "[Linked]", "[linked +> @c]", "[linked", "[ linked", "[  linked; @route"])("retains invalid construct %s without unary recovery", header => {
    const ast = parseDocument(`- [C @c] Conclusion.\n  - ${header}\n    - [G] Premise.`);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(ast.blocks[0].children[0].annotation?.kind).toBe("bearing");
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.some(d => d.severity === "error")).toBe(true);
    expect(explain.entries[1].effects).toContainEqual({ kind: "rejectBearing", reason: "invalid-local-bearing" });
    expect(explain.entries[2].effects).toContainEqual({ kind: "skipBearing", reason: "local-bearing-membership" });
  });

  it("keeps anonymous sources distinct even when their prose is identical", () => {
    const graph = compile("- [C] Target.\n  - [_ +> ^]\n    - [.] Same.\n    - [.] Same.");
    expect(codes(graph)).toEqual([]);
    expect(graph.points).toHaveLength(3);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0]).not.toHaveProperty("text");
    expect(graph.bearings[0].sources).toEqual(graph.points.slice(1).map(p => ({ key: p.key, kind: "point" })));
    expect(new Set(graph.bearings[0].sources.map(s => s.key)).size).toBe(2);
  });

  it("rejects malformed member operators without losing child reasoning or accepting the header note", () => {
    const member = compile("- [C] Target.\n  - [_ +> ^] Route description.\n    - [G +> @] Bad operator.\n      - [O] Premise objection.\n    - [.] Second.");
    expect(codes(member)).toEqual(["MALFORMED_BEARING_TARGETS", "INVALID_LOCAL_BEARING_MEMBER"]);
    expect(member.points.map(p => p.declaration.role)).toEqual(["C", "G", "O", undefined]);
    expect(member.bearings.map(b => b.kind)).toEqual(["challenges"]);
  });

  it("rejects invalid member atomically and preserves its reply subtree", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [_ +> ^; @route]
    - [. @a] Premise.
    - [O @o] Invalid direct objection.
      - [R @r] Reply.
- [O -> @route] Route objection.`);
    expect(graph.points.map(p => p.id)).toEqual(["c", "a", "o", "r", undefined]);
    expect(routes(graph)).toEqual([{ kind: "respondsTo", handle: undefined, sources: ["r"], target: { kind: "point", name: "o" } }]);
    expect(codes(graph)).toEqual(["INVALID_LOCAL_BEARING_MEMBER", "UNKNOWN_TARGET"]);
  });

  it.each([
    ["G", false], ["O", false], ["G", true], ["O", true]
  ] as const)("explains direct %s (use=%s) without changing identity or inferring an attachment", (role, reuse) => {
    const operand = reuse ? " use @premise" : " @premise";
    const ast = parseDocument(`${reuse ? "- [. @premise] Shared material.\n" : ""}- [C @c] Conclusion.
  - [_ +> ^; @route]
    - [.] Another source.
    - [${role}${operand}] Local material.
      - [G @detail] A reason for this material.`);
    const graph = compileGraph(ast);
    expect(graph.diagnostics).toEqual([expect.objectContaining({
      severity: "error",
      code: "INVALID_LOCAL_BEARING_MEMBER",
      message: expect.stringContaining(`Use [.${operand}] for a joint source, [${role}/${operand}]`)
    })]);
    expect(graph.diagnostics[0].message).toContain("no default attachment is created here");
    expect(graph.points.filter(point => point.id === "premise")).toHaveLength(1);
    expect(graph.points.find(point => point.id === "premise")?.declaration).toEqual(
      reuse ? { form: "material" } : { form: "role", role }
    );
    expect(routes(graph)).toEqual([{
      kind: "supports", handle: undefined, sources: ["detail"], target: { kind: "point", name: "premise" }
    }]);
    expect(ast.blocks.at(-1)?.children[0].children[1].annotation).toMatchObject({
      kind: reuse ? "use" : "role", role
    });
  });

  it.each(["G", "O"])("distinguishes the source, Bearing commentary and independent %s rewrites", role => {
    const source = (header: string) => `- [C @c] Conclusion.
  - [_ +> ^; @route]
    - [. @a] First source.
    - [${header}] Another point.`;
    const joint = compile(source(". @b"));
    const commentary = compile(source(`${role}/ @b`));
    const independent = compile(source(`${role} @b ${role === "G" ? "+>" : "->"} @c`));
    for (const graph of [joint, commentary, independent]) expect(graph.diagnostics).toEqual([]);
    expect(joint.bearings).toHaveLength(1);
    expect(routes(joint)[0].sources).toEqual(["a", "b"]);
    for (const graph of [commentary, independent]) {
      expect(routes(graph).find(bearing => bearing.handle === "route")?.sources).toEqual(["a"]);
      expect(graph.bearings).toHaveLength(2);
    }
    const kind = role === "G" ? "supports" : "challenges";
    expect(routes(commentary)).toContainEqual({
      kind, handle: undefined, sources: ["b"], target: { kind: "bearing", name: "route" }
    });
    expect(routes(independent)).toContainEqual({
      kind, handle: undefined, sources: ["b"], target: { kind: "point", name: "c" }
    });
  });

  it.each(["C", "G; @member-route", "G;", "G?", "@ref"])("rejects direct %s atomically", mark => {
    const graph = compile(`- [C] Conclusion.
  - [_ +> ^]
    - [.] Good premise.
    - [${mark}] Invalid member.`);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toContain("INVALID_LOCAL_BEARING_MEMBER");
  });

  it("rejects a direct Question atomically without losing it or restoring unary support", () => {
    const graph = compile("- [C] Conclusion.\n  - [_ +> ^]\n    - [.] Good premise.\n    - [Q] Invalid member.");
    expect(graph.points.map(p => [p.declaration.form, p.declaration.role, p.declaration.status, p.text])).toEqual([
      ["role", "C", undefined, "Conclusion."],
      ["material", undefined, undefined, "Good premise."],
      ["role", "Q", undefined, "Invalid member."]
    ]);
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics).toEqual([{
      severity: "error", code: "INVALID_LOCAL_BEARING_MEMBER",
      message: "A Bearing constructor creates no Point, so a direct Q has no Point to concern. Place it beneath the Point it addresses, write [Q/] to address this Bearing, or give it a named target.",
      sourceSpan: { startLine: 4, startColumn: 7, endLine: 4, endColumn: 26 }
    }]);
  });

  it("retains a complete operator as independent commentary alongside the joint", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [_ +> ^; @route] Rejected route description.
    - [G @a +> @other; @explicit] Explicit reason.
      - [O @o] Objection.
    - [. @b] Other premise.
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
    const graph = compile("- [C @c] Conclusion.\n  - [_ +> ^]\n    - [. @a] Premise.\n    - [edge @a +> @c; @explicit]");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings.map(b => b.handle)).toEqual([undefined, "explicit"]);
  });

  it("rejects body-wrapped members without restoring unary support", () => {
    const { graph, explain } = compileGraphWithExplain(parseDocument(`- [C] Conclusion.
  - [_ +> ^] Header note does not make the wrapper a member.
    - Wrapper.
      - [.] Premise.
        - [O] Premise objection.`));
    expect(codes(graph)).toEqual(["INVALID_LOCAL_BEARING_MEMBER"]);
    expect(graph.points.map(p => p.declaration.role)).toEqual(["C", undefined, "O"]);
    expect(graph.bearings.map(b => b.kind)).toEqual(["challenges"]);
    expect(explain.entries[3].effects).toContainEqual(expect.objectContaining({ kind: "localBearingMember", eligible: false }));
  });

  it.each(["", "    - Wrapper.\n"])("rejects linked nesting across body %j", wrapper => {
    const nestedIndent = wrapper ? "      " : "    ";
    const graph = compile(`- [C] Conclusion.
  - [_ +> ^]
${wrapper}${nestedIndent}- [_ +> ^]
${nestedIndent}  - [.] Premise.`);
    expect(codes(graph)).toEqual(["INVALID_LOCAL_BEARING_MEMBER", "NESTED_LOCAL_BEARING_UNSUPPORTED"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.points).toHaveLength(2);
  });

  it("diagnoses ^ beneath an explicit Bearing once, at the cause", () => {
    const graph = compile(`- [C @c] Conclusion.
- [G @g] Ground.
- [edge @g +> @c]
  - Context.
    - [_ +> ^]
      - [.] Premise.
        - [O] Objection.`);
    expect(codes(graph)).toEqual(["EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"]);
    expect(graph.points).toHaveLength(4);
    expect(graph.bearings.map(b => b.kind)).toEqual(["supports", "challenges"]);
  });

  it("uses existing duplicate-name rejection for the entire source set and dependent routes", () => {
    const graph = compile(`- [C @c] Conclusion.
  - [_ +> ^; @route]
    - [. @same] First.
    - [. @same] Second.
- [O -> @route] Objection.`);
    expect(graph.points.map(p => p.declaration.role)).toEqual(["C", "O"]);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual(["DUPLICATE_ID", "UNRESOLVED_BEARING_TARGET"]);
  });

  it("rejects colliding handles and wrong-kind references using the shared namespace", () => {
    const collision = compile("- [C @route] Conclusion.\n  - [_ +> ^; @route]\n    - [.] Premise.\n- [O -> @route] Objection.");
    expect(collision.points).toHaveLength(3);
    expect(collision.bearings).toEqual([]);
    expect(codes(collision)).toEqual(["POINT_BEARING_ID_CONFLICT"]);
    const badRefs = compile("- [C @c] Conclusion.\n  - [_ +> ^; @route]\n    - [. @a] Premise.\n- [edge @route +> @c]\n- [O -> @route] Wrong target.");
    expect(badRefs.bearings).toHaveLength(2);
    expect(codes(badRefs)).toEqual(["BEARING_IS_NOT_BEARING_SOURCE"]);
    const duplicate = compile("- [C] Conclusion.\n  - [_ +> ^; @route]\n    - [.] First.\n  - [_ +> ^; @route]\n    - [.] Second.");
    expect(duplicate.points).toHaveLength(3);
    expect(duplicate.bearings).toEqual([]);
    expect(codes(duplicate)).toEqual(["DUPLICATE_BEARING_HANDLE"]);
  });

  it("adds no cycle policy to named routes", () => {
    const graph = compile("- [C @c] Conclusion.\n  - [_ +> ^; @route]\n    - [. @a] Premise.\n- [edge @a ~> @self; @self]");
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings[1].target).toEqual({ key: graph.bearings[1].key, kind: "bearing" });
  });

  it("maps linked header and member locations to the host's one-based UTF-16 positions", () => {
    const source = "Intro.\n  ```cog\n  - [C @c] 😀 Target.\n    - [_ +> ^; @route] 😀 說明這一步。\n      - [. @a] 😀 Premise.\n      - [. @b] Second.\n  ```";
    const result = explainSource(source, "host");
    const graph = result.graphs[0];
    expect(codes(graph)).toEqual([]);
    expect(graph.bearings[0].text).toBe("😀 說明這一步。");
    expect(graph.bearings[0].sourceSpan).toEqual({ startLine: 4, endLine: 4, startColumn: 7, endColumn: source.split("\n")[3].length + 1 });
    expect(graph.bearings[0].sourceSpan!.endColumn).toBe(33);
    expect(graph.points[1].sourceSpan).toEqual({ startLine: 5, endLine: 5, startColumn: 9, endColumn: source.split("\n")[4].length + 1 });
    expect(result.explanations[0].entries[2].effects).toContainEqual({ kind: "localBearingMember", localBearingSpan: graph.bearings[0].sourceSpan, eligible: true, function: "source" });
  });

  it("matches normalized edge topology while retaining Point role, form, status, content, and names", () => {
    const linked = compile("- [C @c] Conclusion.\n  - [_ +> ^; @route] 說明這一步。\n    - [. @a] First.\n      - [O @o] Objection.\n        - [R @r] Reply.\n    - [. @b] Second.\n- [O @u -> @route] Undercut.");
    const edge = compile("- [C @c] Conclusion.\n- [. @a] First.\n  - [O @o] Objection.\n    - [R @r] Reply.\n- [. @b] Second.\n- [edge @a, @b +> @c; @route] 說明這一步。\n- [O @u -> @route] Undercut.");
    expect(codes(linked)).toEqual([]);
    expect(codes(edge)).toEqual([]);
    expect(linked.bearings.find(b => b.handle === "route")?.text).toBe("說明這一步。");
    expect(normalize(linked)).toEqual(normalize(edge));
  });

  it.each(["[joining the discussion]", "[joined]", "[linking]", "[linked-data]"])("keeps ordinary G siblings unary through %s body", header => {
    const graph = compile("- [C] Conclusion.\n  - " + header + " Context.\n    - [G] First.\n    - [G] Second.");
    expect(codes(graph)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY", "IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
    expect(graph.bearings.map(b => b.sources.length)).toEqual([1, 1]);
    const ast = parseDocument("  - [linked");
    expect(ast.blocks[0].annotation).toEqual({ kind: "invalid", raw: "linked" });
    expect(ast.diagnostics.map(d => d.code)).toEqual(["INDENTED_ROOT_UNSUPPORTED"]);
  });
});
