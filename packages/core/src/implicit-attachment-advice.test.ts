import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";
import type { AstBlock, GraphCompilation } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const advice = (result: GraphCompilation) => result.graph.diagnostics.filter(diagnostic => diagnostic.code === "IMPLICIT_ATTACHMENT_THROUGH_BODY");
const throughBodySelections = (result: GraphCompilation) => result.explain.entries.flatMap(entry => entry.effects.filter(effect => effect.kind === "implicitAttachment" && effect.crossedBodySpans.length > 0).map(effect => ({ line: entry.sourceSpan.startLine, ...effect })));

describe("advice from actual implicit selection", () => {
  it.each([["C", "G", "supports"], ["C", "O", "challenges"], ["C", "D", "clarifies"], ["Q", "R", "respondsTo"]])("reports %s > body > %s as %s", (parent, child, kind) => {
    const ast = parseDocument("- [" + parent + " @target] Target.\n  - First body\n    - Second body\n      - [" + child + "] Source.");
    const result = compileGraphWithExplain(ast);
    expect(result.graph.bearings[0].kind).toBe(kind);
    expect(advice(result)).toEqual([expect.objectContaining({ severity: "suggestion", sourceSpan: ast.blocks[0].children[0].children[0].children[0].sourceSpan, message: expect.stringContaining("@target") })]);
    expect(throughBodySelections(result)).toEqual([{ line: 4, kind: "implicitAttachment", target: { kind: "point", key: "_p1" }, targetSpan: ast.blocks[0].sourceSpan, contextSpan: ast.blocks[0].sourceSpan, crossedBodySpans: [ast.blocks[0].children[0].sourceSpan, ast.blocks[0].children[0].children[0].sourceSpan] }]);
    const withoutBody = structuredClone(ast);
    const unwrap = (blocks: AstBlock[]): AstBlock[] => blocks.flatMap(block => block.annotation ? [{ ...block, children: unwrap(block.children) }] : unwrap(block.children));
    withoutBody.blocks = unwrap(withoutBody.blocks);
    const counterfactual = compileGraphWithExplain(withoutBody);
    expect(result.graph.points).toEqual(counterfactual.graph.points);
    expect(result.graph.bearings).toEqual(counterfactual.graph.bearings);
    expect(counterfactual.graph.diagnostics).toEqual([]);
  });

  it("distinguishes a reused Point's canonical span from its local selected context", () => {
    const ast = parseDocument("- [Q @topic] Original inquiry.\n- [Q use @topic] Local occurrence.\n  - Commentary\n    - [R] Reply.\n      - [G] Inner reason.");
    const result = compileGraphWithExplain(ast);
    expect(throughBodySelections(result)).toEqual([{ line: 4, kind: "implicitAttachment", target: { kind: "point", key: "_p1" }, targetSpan: ast.blocks[0].sourceSpan, contextSpan: ast.blocks[1].sourceSpan, crossedBodySpans: [ast.blocks[1].children[0].sourceSpan] }]);
    expect(result.graph.bearings.map(bearing => bearing.kind)).toEqual(["respondsTo", "supports"]);
  });

  it("changing a root heading to Q does not turn grouped Claims into answers", () => {
    const children = "\n  - Reconstruction\n    - [C @reconstruction] Reconstructed answer.\n      - [G] Reason.\n  - Independent assessment\n    - [C @assessment] Our assessment.\n      - [O] Concern.";
    expect(advice(compile("- Reading" + children))).toEqual([]);
    const result = compile("- [Q @inquiry] Reading" + children);
    expect(throughBodySelections(result)).toEqual([]);
    expect(advice(result)).toEqual([]);
    expect(result.graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "challenges"]);
  });

  it("advises on linked target lookup and slash attachment through body", () => {
    const result = compile("- [C @c] Claim.\n  - Group\n    - [_ G; @route]\n      - [note] Literal\n      - [. @g] Ground.\n      - Commentary\n        - [O/] Rejected linked body member.");
    expect(advice(result)).toEqual([]);
    const valid = compile("- [C @c] Claim.\n  - Group\n    - [_ G; @route]\n      - [note] Detail.\n      - [. @g] Ground.\n        - Text\n          - [G/] Ground has no attachment.\n- [_ use @route]\n  - Commentary\n    - [O/] Route concern.\n- [_ use @route]\n  - [O/] Direct concern.");
    expect(throughBodySelections(valid).map(effect => [effect.line, effect.target.kind])).toEqual([[3, "point"], [10, "bearing"]]);
    expect(valid.graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "challenges", "challenges"]);
    const selected = throughBodySelections(valid)[1];
    expect(selected.targetSpan?.startLine).toBe(3);
    expect(selected.contextSpan.startLine).toBe(8);
  });

  it("uses the actual span for an anonymous selected Bearing", () => {
    const result = compile("- [C] Claim.\n  - [G] Reason.\n    - Prose\n      - [G/] Extra support for this inference.");
    expect(advice(result)[0].message).toContain("bearing at 2:5–2:16");
    expect(throughBodySelections(result)[0].target).toEqual({ kind: "bearing", key: "_b1" });
  });

  it.each([
    "- [C] Claim.\n  - Body\n    - [_ G]\n      - [.] First.\n      - [.] Second.",
    "- [C] Claim.\n  - [G] Reason.\n    - Body\n      - [O/] Concern.",
    "- [C @c] Claim.\n  - [G @g; @route] Reason.\n- [_ use @route]\n  - Body\n    - [G/] Warrant."
  ])("preserves complete graph projection when transparent body is removed from %s", source => {
    const ast = parseDocument(source);
    const withBody = compileGraphWithExplain(ast);
    const unwrap = (blocks: AstBlock[]): AstBlock[] => blocks.flatMap(block => block.annotation ? [{ ...block, children: unwrap(block.children) }] : unwrap(block.children));
    const withoutBody = compileGraphWithExplain({ ...ast, blocks: unwrap(ast.blocks) });
    expect(withBody.graph.points).toEqual(withoutBody.graph.points);
    expect(withBody.graph.bearings).toEqual(withoutBody.graph.bearings);
    expect(advice(withBody)).toHaveLength(1);
    expect(withoutBody.graph.diagnostics).toEqual([]);
  });

  it("maps anonymous target and crossed body spans through an indented host fence", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const result = explainSource("Host 😀\n  " + fence + "cog\n  - [Q] 問題😀\n    - 第一段😀\n      - 第二段\n        - [R] 回答😀\n  " + fence, "host");
    const graph = result.graphs[0], explain = result.explanations[0];
    const selection = throughBodySelections({ graph, explain })[0];
    expect(selection).toMatchObject({ line: 6, targetSpan: { startLine: 3, startColumn: 5, endLine: 3, endColumn: 13 }, contextSpan: graph.points[0].sourceSpan, crossedBodySpans: [{ startLine: 4, startColumn: 7, endLine: 4, endColumn: 12 }, { startLine: 5, startColumn: 9, endLine: 5, endColumn: 12 }] });
    expect(advice({ graph, explain })[0]).toMatchObject({ sourceSpan: graph.points[1].sourceSpan, message: expect.stringContaining("point at 3:5–3:13") });
  });

  it.each([
    "- Organisation\n  - [C] Claim.\n    - [G] Reason.\n  - Leaf prose",
    "- [C @c] Claim.\n  - Body\n    - [C] Inner.\n      - [G] Reason.",
    "- [Q @q] Question.\n  - Body\n    - [C] Seconds.\n    - [.] Background.",
    "- [C @c] Claim.\n  - Body\n    - [Q] Which scale?",
    "- [C @c] Claim.\n  - Body\n    - [G +> @c] Explicit.\n    - [_ @c +> @c] Explicit edge.",
    "- [C] Claim.\n  - [note]\n    - Body\n      - [G] Literal.",
    "- [C] Claim.\n  - Body\n    - [O/] No exposed attachment.",
    "- [C @duplicate] One.\n- [C @duplicate] Two.\n  - Body\n    - [G] Cannot select duplicate.",
    "- [C] Claim.\n  - [_ use @future]\n    - Body\n      - [O/] Forward invalid.\n- [_ @missing +> @missing; @future]",
    "- [C @c] Claim.\n  - [G use @missing; @route]\n    - Body\n      - [O/] Dependent on rejected source.",
    "- [C @c] Claim.\n  - [_ G]\n    - [. use @missing]\n    - [O/] Commentary.\n      - Body\n        - [G/] Dependent on rejected linked."
  ])("does not invent successful advice for %s", source => {
    const result = compile(source);
    expect(advice(result)).toEqual([]);
    expect(throughBodySelections(result)).toEqual([]);
  });

  // Each suggested spelling already exists; following it must keep the same
  // topology without advice and without a second relation.
  const topology = (result: GraphCompilation) => {
    const names = new Map([...result.graph.points.map(point => [point.key, "@" + (point.id ?? point.text)] as const), ...result.graph.bearings.map(bearing => [bearing.key, "@" + (bearing.handle ?? bearing.key)] as const)]);
    return result.graph.bearings.map(bearing => [bearing.sources.map(source => names.get(source.key)), bearing.kind, names.get(bearing.target.key), bearing.handle]);
  };
  it.each([
    ["- [C @c] Claim.\n  - Body\n    - [G @g; @step] Reason.", "[G @g +> @c; @step]", "- [C @c] Claim.\n  - Body\n    - [G @g +> @c; @step] Reason."],
    ["- [C @c] Claim.\n  - [G @g; @step] Reason.\n    - Body\n      - [O/ @o] Concern.", "[O @o /> @step]", "- [C @c] Claim.\n  - [G @g; @step] Reason.\n    - Body\n      - [O @o /> @step] Concern."],
    ["- [O @o] Objection.\n  - Body\n    - [R @r] Reply.", "[R @r respondsTo @o]", "- [O @o] Objection.\n  - Body\n    - [R @r respondsTo @o] Reply."],
    ["- [C @c] Claim.\n  - Body\n    - [D use @d] Local distinction.\n- [. @d] Shared distinction.", "[D use @d clarifies @c]", "- [C @c] Claim.\n  - Body\n    - [D use @d clarifies @c] Local distinction.\n- [. @d] Shared distinction."],
    ["- [C @c] Claim.\n  - Body\n    - [_ G; @route]\n      - [. @a] A.\n      - [. @b] B.", "write [_ @a, @b +> @c; @route] in place of the local Bearing header, move its neutral source occurrences with their subtrees before the constructor, outside enclosing Bearing contexts", "- [C @c] Claim.\n- Body\n  - [. @a] A.\n  - [. @b] B.\n- [_ @a, @b +> @c; @route]"]
  ])("teaches an existing explicit spelling for %s", (source, suggestion, followed) => {
    const result = compile(source);
    expect(advice(result)).toHaveLength(1);
    expect(advice(result)[0].explanation).toContain(suggestion);
    expect(advice(result)[0].explanation).toContain("Choosing note instead excludes the whole subtree from the graph.");
    const explicit = compile(followed);
    expect(explicit.graph.diagnostics).toEqual([]);
    expect(topology(explicit)).toEqual(topology(result));
  });

  it.each([["G", "C", "+>"], ["O", "C", "->"], ["R", "O", "respondsTo"], ["D", "C", "clarifies"]])(
    "keeps the %s linked relation and neutral declarations when following its advice",
    (role, parent, operator) => {
      const before = compile(`- [${parent} @target] Target.
  - Body
    - [_ ${role}; @route] Description.
      - [. @a] First.
        - [O @doubt] Doubt about the source.
      - [. @b] Second.`);
      expect(advice(before)[0].explanation).toContain(`write [_ @a, @b ${operator} @target; @route]`);
      const after = compile(`- [${parent} @target] Target.
  - Body
    - [_ @a, @b ${operator} @target; @route] Description.
    - [. @a] First.
      - [O @doubt] Doubt about the source.
    - [. @b] Second.`);
      expect(after.graph.diagnostics).toEqual([]);
      expect(topology(after)).toEqual(topology(before));
      expect(after.graph.points.map(({ id, declaration, text }) => ({ id, declaration, text })))
        .toEqual(before.graph.points.map(({ id, declaration, text }) => ({ id, declaration, text })));
      expect(after.graph.bearings.map(bearing => bearing.text)).toEqual(before.graph.bearings.map(bearing => bearing.text));
    }
  );

  it("names the missing names instead of inventing them for anonymous Points", () => {
    expect(advice(compile("- [Q] Question.\n  - Body\n    - [R] Reply."))[0].explanation).toContain("[R respondsTo @target] after naming the target");
    const linked = advice(compile("- [C] Claim.\n  - Body\n    - [_ G]\n      - [.] First.\n      - [.] Second."))[0].explanation;
    expect(linked).toContain("[_ @source, @source2 +> @target] in place of the local Bearing header after naming each placeholder Point");
    expect(advice(compile("- [C] Claim.\n  - Body\n    - [O] Concern."))[0].explanation).toContain("[O -> @target] after naming the target");
  });

  it("derives linked advice from the surviving joint sources and keeps independent members", () => {
    const declarations = "- [G @a] A.\n- [G @b] B.\n- [C @other] Other.\n- [C @c] Claim.\n  - grouping\n";
    const result = compile(declarations + "    - [_ G; @joint]\n      - [. use @a]\n      - [G use @b +> @other]\n      - [note] Kept with the step.\n      - [O/ @doubt] The step needs a mechanism.");
    const explanation = advice(result)[0].explanation ?? "";
    expect(explanation).toContain("write [_ @a +> @c; @joint] in place of the local Bearing header");
    expect(explanation).not.toContain("@b +>");
    const followed = compile(declarations + "    - [_ @a +> @c; @joint]\n      - [G use @b +> @other]\n      - [note] Kept with the step.\n      - [O/ @doubt] The step needs a mechanism.\n- [. use @a]");
    expect(followed.graph.diagnostics).toEqual([]);
    expect(topology(followed)).toEqual(topology(result));
    expect(topology(result)).toEqual([[["@a"], "supports", "@c", "joint"], [["@b"], "supports", "@other", undefined], [["@doubt"], "challenges", "@joint", undefined]]);
  });

  it("keeps the handle, Point children and attachment commentary in place when a named clause replaces a default", () => {
    const result = compile("- [Q @q] Question.\n  - grouping\n    - [R @a; @answer] Reply.\n      - [G] Reason for the reply.\n      - [O/ @o] Concern about replying.");
    const explanation = advice(result)[0].explanation ?? "";
    expect(explanation).toContain("write [R @a respondsTo @q; @answer]");
    expect(explanation).toContain("the clause replaces the default rather than adding a second Bearing");
    const followed = compile("- [Q @q] Question.\n  - grouping\n    - [R @a respondsTo @q; @answer] Reply.\n      - [G] Reason for the reply.\n      - [O/ @o] Concern about replying.");
    expect(followed.graph.diagnostics).toEqual([]);
    expect(topology(followed)).toEqual(topology(result));
    expect(followed.graph.points).toEqual(result.graph.points.map((point, index) => index === 1 ? { ...point, sourceSpan: followed.graph.points[1].sourceSpan } : point));
    expect(topology(result)).toHaveLength(3);
  });

  it("keeps placeholders clear of every authored name in the source unit", () => {
    const names = "- [G @source] Named.\n- [C @c] Claim.\n  - [G @source2; @target] Also named.\n  - body\n";
    const linked = compile(names + "    - [_ G]\n      - [.] Anonymous.\n      - [. use @source]");
    expect(advice(linked)[0].explanation).toContain("write [_ @source3, @source +> @c] in place of the local Bearing header after naming each placeholder Point");
    const reply = compile("- [. @target] Taken.\n- [. @source] Taken.\n- [C @c] Claim.\n  - [G; @source2] Taken route.\n- [Q] Question.\n  - body\n    - [R] Reply.");
    expect(advice(reply)[0].explanation).toContain("[R respondsTo @target2] after naming the target");
    // Following the advice with those spellings reproduces the joint support without diagnostics.
    const followed = compile(names + "    - [_ @source3, @source +> @c]\n- [. @source3] Anonymous.");
    expect(followed.graph.diagnostics).toEqual([]);
    const ids = (result: GraphCompilation) => result.graph.bearings.map(bearing => [bearing.sources.length, bearing.kind, bearing.handle]);
    expect(ids(followed)).toEqual(ids(linked));
    expect(followed.graph.bearings.at(-1)?.sources.map(source => followed.graph.points.find(point => point.key === source.key)?.id)).toEqual(["source3", "source"]);
  });
});
