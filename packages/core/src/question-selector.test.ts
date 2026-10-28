import { describe, expect, it } from "vitest";
import {
  analyzeSourceReferences, compileGraphWithExplain, explainSource, formatGraph,
  parseDocument, previewExplicitTarget
} from "./index.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const premise = "- [C @claim] The visitor may be familiar.\n  - [G @silent; @step] The dog did not bark.";

describe("questions concerning a local Bearing", () => {
  it("retains the original step and replies to the question without adding a premise", () => {
    const source = premise + `
    - [Q/ @conditions; @inquiry] When does silence support familiarity?
      - [R @reply] When the dog is awake and usually barks at strangers.
      - [C] The record omits the dog's condition.
      - [Q] Which recording should we inspect?`;
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points.map(point => point.id)).toEqual(["claim", "silent", "conditions", "reply", undefined, undefined]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "concerns", "respondsTo"]);
    expect(graph.bearings[0].sources).toEqual([{ kind: "point", key: graph.points[1].key }]);
    expect(graph.bearings[1]).toMatchObject({
      sources: [{ kind: "point", key: graph.points[2].key }],
      target: { kind: "bearing", key: graph.bearings[0].key }, handle: "inquiry", derivedBy: "structural"
    });
    expect(graph.bearings[1].text).toBeUndefined();
    expect(graph.bearings[2].target).toEqual({ kind: "point", key: graph.points[2].key });
    expect(ast.blocks[0].children[0].children[0].annotation).toMatchObject({
      kind: "role", role: "Q", selector: "attachment", anchor: "conditions", handle: "inquiry"
    });
    expect(explain.entries[2].effects).toContainEqual({
      kind: "selectAttachment", ownerSpan: graph.points[1].sourceSpan,
      target: { kind: "bearing", key: graph.bearings[0].key }
    });
    expect(graph.notes).toEqual([]);
  });

  it.each(["supports", "challenges", "concerns", "answers", "respondsTo", "clarifies"])(
    "can ask about an unnamed %s attachment without changing its kind", kind => {
      const { graph } = compile(`- [. @target] Target.
  - [. ${kind} @target] Source.
    - [Q/] What makes this connection appropriate?`);
      expect(graph.diagnostics).toEqual([]);
      expect(graph.bearings.map(bearing => bearing.kind)).toEqual([kind, "concerns"]);
      expect(graph.bearings[0].handle).toBeUndefined();
      expect(graph.bearings[1].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
    }
  );

  it("distinguishes a bare question, a question about the Point and a question about its step", () => {
    const bare = compile(premise + "\n    - [Q @question] What needs checking?");
    const point = compile(premise + "\n    - [Q @question ~> @silent] What needs checking?");
    const step = compile(premise + "\n    - [Q/ @question] What needs checking?");
    expect(bare.graph.diagnostics).toEqual([]);
    expect(point.graph.diagnostics).toEqual([]);
    expect(step.graph.diagnostics).toEqual([]);
    expect(bare.graph.bearings).toHaveLength(1);
    expect(point.graph.bearings[1].target).toEqual({ kind: "point", key: point.graph.points[1].key });
    expect(step.graph.bearings[1].target).toEqual({ kind: "bearing", key: step.graph.bearings[0].key });
  });

  it("keeps questions separate from a local construction's ordered neutral sources", () => {
    const { graph, explain } = compile(`- [C] The visitor may be familiar.
  - [_ G; @step]
    - [. @silent] The dog did not bark.
    - [. @usual] The dog usually barks at strangers.
    - [Q/ @condition] Was the dog able to bark?
      - [R] A recording may tell us.`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "concerns", "respondsTo"]);
    expect(graph.bearings[0].sources).toEqual([
      { kind: "point", key: graph.points[1].key }, { kind: "point", key: graph.points[2].key }
    ]);
    expect(graph.bearings[1].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
    expect(explain.entries[4].effects).toContainEqual({
      kind: "localBearingMember", localBearingSpan: graph.bearings[0].sourceSpan,
      eligible: false, function: "commentary"
    });
  });

  it.each(["/>", "->", "challenges"])("retains Q %s as an explicit challenge rather than a relevance selector", operator => {
    const { graph } = compile(premise + `\n    - [Q ${operator} @step] Does this step neglect the dog's condition?`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "challenges"]);
    expect(graph.bearings[1]).toMatchObject({
      derivedBy: "operator", target: { kind: "bearing", key: graph.bearings[0].key }
    });
    expect(graph.points[2].declaration).toEqual({ form: "role", role: "Q" });
  });

  it.each(["_", "edge", "bearing"])("selects explicit %s constructions and forward Bearing uses", family => {
    const { graph, explain } = compile(`- [${family} use @step]
  - [Q/ @first] Is this step appropriate here?
- [. @source] Source.
- [. @target] Target.
- [${family} @source +> @target; @step]
  - [Q/ @second] Which conditions apply?`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points).toHaveLength(4);
    const step = graph.bearings.find(bearing => bearing.handle === "step")!;
    const queries = graph.bearings.filter(bearing => bearing.kind === "concerns");
    expect(queries).toHaveLength(2);
    expect(queries.map(bearing => bearing.target)).toEqual([
      { kind: "bearing", key: step.key }, { kind: "bearing", key: step.key }
    ]);
    expect(explain.entries[1].effects).toContainEqual({
      kind: "selectBearing", contextSpan: explain.entries[0].sourceSpan,
      target: { kind: "bearing", key: step.key }
    });
  });

  it("reuses shared question content while keeping local prose, notes and references separate", () => {
    const source = `- [. @question] Does the observation establish this step?
${premise}
    - [Q/ use @question; @inquiry] Consider the timing here.
      - [. note] The question's source.
      - [_ note] Why this question matters for this use.`;
    const result = explainSource(source), graph = result.graphs[0];
    expect(result.diagnostics).toEqual([]);
    expect(graph.points).toHaveLength(3);
    expect(graph.points[0]).toMatchObject({
      text: "Does the observation establish this step?", declaration: { form: "material" }
    });
    expect(graph.bearings[1]).toMatchObject({
      kind: "concerns", handle: "inquiry", sources: [{ kind: "point", key: graph.points[0].key }],
      target: { kind: "bearing", key: graph.bearings[0].key }
    });
    expect(graph.bearings[1].text).toBeUndefined();
    expect(result.documents[0].blocks[1].children[0].children[0].text).toBe("Consider the timing here.");
    expect(graph.notes.map(note => note.target)).toEqual([
      { kind: "point", key: graph.points[0].key }, { kind: "bearing", key: graph.bearings[1].key }
    ]);
    const inventory = analyzeSourceReferences(source).references;
    expect(inventory.status).toBe("complete");
    if (inventory.status !== "complete") throw new Error("Expected complete reference inventory.");
    expect(inventory.units[0].find(name => name.name === "question")!.references.map(ref => ref.kind)).toEqual(["point-use"]);
    expect(inventory.units[0].find(name => name.name === "step")!.references).toEqual([]);
  });

  it("selects the question's own attachment for recursive commentary", () => {
    const { graph } = compile(premise + `
    - [Q/ @first; @query] Which conditions apply?
      - [Q/ @second] Why is that question relevant?
      - [G/] Timing determines whether this question is relevant.
      - [R] Check the dog's condition.`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual([
      "supports", "concerns", "concerns", "supports", "respondsTo"
    ]);
    expect(graph.bearings.slice(2, 4).map(bearing => bearing.target)).toEqual([
      { kind: "bearing", key: graph.bearings[1].key }, { kind: "bearing", key: graph.bearings[1].key }
    ]);
    expect(graph.bearings[4].target).toEqual({ kind: "point", key: graph.points[2].key });
  });

  it.each([
    "- [Q/] No local step.",
    "- [C] Claim.\n  - [Q/] No local step.",
    premise + "\n    - [Q] A nearer question.\n      - [Q/] No local step.",
    "- [C] Claim.\n  - [_ G]\n    - [.] Source.\n      - [Q/] A member owns no attachment."
  ])("does not cross a nearer context without an attachment: %s", source => {
    const { graph } = compile(source);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(graph.bearings.some(bearing => bearing.kind === "concerns")).toBe(false);
  });

  it("retains failed attachment dependencies without selecting a surviving outer step", () => {
    const { graph } = compile(premise + `
    - [G +> @missing; @failed] A failed step.
      - [Q/] Which condition applies?`);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["UNKNOWN_TARGET", "UNRESOLVED_BEARING_TARGET"]);
    expect(graph.bearings.map(bearing => bearing.handle)).toEqual(["step"]);
  });

  it.each([
    "[Q/ ~> @step]", "[Q/ respondsTo @claim]", "[Q/ @a @b]", "[Q/;]", "[q/]", "[Q/",
    "[Q/ use @question ~> @step]"
  ])("retains malformed selector %s as commentary rather than a joint source", header => {
    const { graph } = compile(`- [. @question] Which conditions apply?
- [C @claim] Claim.
  - [_ G; @step]
    - [. @source] Source.
    - ${header}
      - [G] A reason for the retained Point.`);
    expect(graph.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
    expect(graph.diagnostics.some(diagnostic => diagnostic.code === "INVALID_LOCAL_BEARING_MEMBER")).toBe(false);
    expect(graph.bearings[0]).toMatchObject({
      handle: "step", sources: [{ kind: "point", key: graph.points.find(point => point.id === "source")!.key }]
    });
    expect(graph.bearings.some(bearing => bearing.kind === "concerns")).toBe(false);
  });

  it("offers a correct explicit spelling through body while the edit preview still declines selectors", () => {
    const source = premise + "\n    - Context.\n      - [Q/ @question; @inquiry] Which conditions apply?";
    const before = compile(source);
    expect(before.graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
    expect(before.graph.diagnostics[0].explanation).toContain("[Q @question ~> @step; @inquiry]");
    const explicit = compile(source.replace("[Q/ @question; @inquiry]", "[Q @question ~> @step; @inquiry]"));
    expect(explicit.graph.diagnostics).toEqual([]);
    expect(formatGraph(explicit.graph)).toBe(formatGraph({ ...before.graph, diagnostics: [] }));
    expect(previewExplicitTarget(source, { line: 4 })).toMatchObject({
      status: "unavailable", reason: "unsupported-attachment"
    });
  });

  it.each(["G", "O", "Q"])("retains an unclosed %s/ use as failed commentary without rejecting the joint", role => {
    const ast = parseDocument(`- [. @question] Which condition applies?
- [C] Claim.
  - [_ G; @step]
    - [. @source] Source.
    - [${role}/ use @question`);
    const { graph } = compileGraphWithExplain(ast);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["MALFORMED_ANNOTATION_PREFIX"]);
    expect(graph.points).toHaveLength(3);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0]).toMatchObject({
      handle: "step", sources: [{ kind: "point", key: graph.points[2].key }]
    });
    expect(ast.blocks[1].children[0].children[1].annotation).toMatchObject({
      kind: "use", role, selector: "attachment", syntaxErrors: ["reference"]
    });
  });

  it("keeps annotation-looking questions literal inside notes", () => {
    const { graph } = compile(premise + "\n    - [note] Quoted discussion.\n      - [Q/] A literal question.");
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points).toHaveLength(2);
    expect(graph.bearings).toHaveLength(1);
  });
});
