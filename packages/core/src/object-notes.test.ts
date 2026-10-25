import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { analyzeSourceReferences, compileSource, explainSource, parseDocument, previewExplicitTarget } from "./index.js";

const compile = (source: string) => explainSource(source);
const errors = (source: string) => compile(source).diagnostics.filter(d => d.severity === "error").map(d => d.code);
const graph = (source: string) => compile(source).graphs[0];
const declarations = "- [C @p] Premise.\n- [C @q] Claim.\n- [_ @p +> @q; @r] Constructor description.";

describe("source-backed object notes", () => {
  it("selects the Point and its occurrence's new attachment separately, including use", () => {
    const source = "- [C @p] Original.\n- [C @q] Claim.\n  - [G use @p; @r] Here yesterday.\n    - [. note] Point note.\n    - [_ note] Route note.\n      - [O @hidden] Literal objection.";
    const result = compile(source), g = result.graphs[0];
    expect(errors(source)).toEqual([]);
    expect(g.points.map(p => p.text)).toEqual(["Original.", "Claim."]);
    expect(g.bearings).toHaveLength(1);
    expect(g.bearings[0].text).toBeUndefined();
    expect(g.notes.map(n => [n.origin, n.target, n.sourceSpan.startLine])).toEqual([
      ["note", { kind: "point", key: g.points[0].key }, 4],
      ["note", { kind: "bearing", key: g.bearings[0].key }, 5]
    ]);
    expect(result.documents[0].blocks[1].children[0].children[1].children[0].annotation).toBeUndefined();
    expect(result.explanations[0].entries.map(e => e.sourceSpan.startLine)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reuses fixed Bearing identity and endpoints without copying records or promoting use prose", () => {
    const source = declarations + "\n  - [_ note] Here yesterday.\n- [_ use @r] Occurrence prose.\n  - [note] Local only.\n  - [_ note] Here yesterday.\n- [edge use @r]\n- [bearing use @r]";
    const g = graph(source);
    expect(errors(source)).toEqual([]);
    expect(g.bearings).toHaveLength(1);
    expect(g.bearings[0]).toMatchObject({
      sources: [{ kind: "point", key: g.points[0].key }], target: { kind: "point", key: g.points[1].key },
      text: "Constructor description."
    });
    expect(g.notes.map(n => [n.origin, n.sourceSpan.startLine])).toEqual([
      ["constructor-description", 3], ["note", 4], ["note", 7]
    ]);
    expect(g.notes.every(n => n.target.key === g.bearings[0].key)).toBe(true);
  });

  it("handles anonymous objects and joint contexts without a unary attachment for a direct member", () => {
    const source = "- [C] Claim.\n  - [. note] Anonymous Point.\n  - [linked] Joint description.\n    - [G] A.\n      - [. note] Member Point.\n      - [_ note] No unary route.\n    - [G] B.\n    - [_ note] The joint.";
    const g = graph(source);
    expect(errors(source)).toEqual(["NO_LOCAL_NOTE_TARGET"]);
    expect(g.bearings).toHaveLength(1);
    expect(g.bearings[0].sources).toHaveLength(2);
    expect(g.notes.map(n => [n.sourceSpan.startLine, n.target.kind])).toEqual([
      [2, "point"], [3, "bearing"], [5, "point"], [8, "bearing"]
    ]);
  });

  it("crosses legal ordinary body but preserves failed linked membership", () => {
    const source = "- [C] Claim.\n  - [G] Ground.\n    - Ordinary body\n      - [. note] Point.\n      - [_ note] Attachment.";
    const result = compile(source);
    expect(errors(source)).toEqual([]);
    for (const entry of result.explanations[0].entries.slice(3)) {
      expect(entry.effects).toContainEqual(expect.objectContaining({
        kind: "selectNoteTarget", contextSpan: expect.objectContaining({ startLine: 2 }),
        crossedBodySpans: [expect.objectContaining({ startLine: 3 })]
      }));
    }
    const illegal = "- [C] Claim.\n  - [linked]\n    - [G] Ground.\n    - Ordinary group\n      - [_ note] Must not rescue the joint.";
    expect(errors(illegal)).toEqual(["INVALID_LINKED_MEMBER", "NO_LOCAL_NOTE_TARGET"]);
    expect(graph(illegal).notes).toEqual([]);
    expect(graph(illegal).bearings).toEqual([]);
  });

  it.each([
    "- [. note] No context.",
    "- [_ note] No context.",
    "- [C] Outer.\n  - [.] Nearer Point.\n    - [_ note] No attachment.",
    declarations + "\n  - [. note] A Bearing context has no Point slot.",
    declarations + "\n- [_ use @r]\n  - [. note] Must not borrow an endpoint.",
    declarations + "\n- [point use @p]\n  - [_ note] Must not borrow a remote outgoing route.",
    "- [C] Outer.\n  - [point bad] Failed Point.\n    - [. note] No fallback.",
    "- [C] Outer.\n  - [bearing bad] Failed Bearing.\n    - [_ note] No fallback."
  ])("does not search outward from missing or inappropriate local slots: %s", source => {
    expect(errors(source)).toContain("NO_LOCAL_NOTE_TARGET");
    expect(graph(source).notes.filter(n => n.origin === "note")).toEqual([]);
  });

  it.each([
    "- [point use @missing]\n  - [. note] Missing.",
    "- [bearing use @missing]\n  - [_ note] Missing.",
    "- [C @q] Claim.\n  - [G +> @missing] Failed attachment.\n    - [_ note] Failed.",
    "- [C @q] Claim.\n- [C @q] Duplicate.\n  - [. note] Failed Point.",
    "- [C @p] Point.\n- [bearing use @p]\n  - [_ note] Wrong type.",
    declarations + "\n- [point use @r]\n  - [. note] Wrong type."
  ])("waits for validation before accepting a local target: %s", source => {
    expect(errors(source)).toContain("INVALID_LOCAL_NOTE_TARGET");
    expect(graph(source).notes.filter(n => n.origin === "note")).toEqual([]);
  });

  it.each(["note", ". note", "point note", "node note", "_ note", "bearing note", "edge note"])(
    "preserves malformed and unclosed [%s] as literal boundaries", head => {
      for (const suffix of [" @target]", "; @anchor]", " bad]", "", " +> @q]", "+>@q]"]) {
        const source = `- [C @q] Outer.\n  - [${head}${suffix}\n    - [C? @q] Literal retired annotation.\n    - [G +> @missing] Literal relation.\n      - [edge use @bad] Literal use.`;
        const result = compile(source), block = result.documents[0].blocks[0].children[0];
        expect(errors(source)).toEqual(["MALFORMED_NOTE"]);
        expect(block.annotation).toMatchObject({ kind: "note", syntaxErrors: ["note"] });
        expect(block.children.every(child => !child.annotation)).toBe(true);
        expect(result.graphs[0].points).toHaveLength(1);
        expect(result.graphs[0].bearings).toEqual([]);
        expect(result.graphs[0].notes).toEqual([]);
      }
    }
  );

  it("changes a note's target when its authored location moves, without merging equal text", () => {
    const before = graph("- [C @a] A.\n  - [. note] Same.\n  - [. note] Same.\n- [C @b] B.");
    const after = graph("- [C @a] A.\n  - [. note] Same.\n- [C @b] B.\n  - [. note] Same.");
    expect(before.notes.map(n => n.target.key)).toEqual([before.points[0].key, before.points[0].key]);
    expect(after.notes.map(n => n.target.key)).toEqual([after.points[0].key, after.points[1].key]);
  });

  it("keeps different Bearings with the same endpoints and their notes distinct", () => {
    const g = graph(declarations + "\n  - [_ note] First.\n- [edge @p supports @q; @s] Other.\n  - [_ note] Second.");
    expect(g.bearings).toHaveLength(2);
    expect(g.bearings[0].key).not.toBe(g.bearings[1].key);
    expect(g.notes.filter(n => n.origin === "note").map(n => n.target.key)).toEqual(g.bearings.map(b => b.key));
  });

  it("resolves forward uses and withholds notes on a transitively rejected Bearing", () => {
    const valid = graph("- [bearing use @r]\n  - [_ note] Written before construction.\n" + declarations);
    expect(valid.notes.map(n => n.sourceSpan.startLine)).toEqual([2, 5]);
    expect(valid.notes[0].target).toEqual(valid.notes[1].target);
    const invalid = "- [C @p] Point.\n- [_ @p +> @missing; @bad]\n- [_ @p +> @bad; @dependent]\n- [bearing use @dependent]\n  - [_ note] Must not survive target rejection.";
    expect(errors(invalid)).toContain("INVALID_LOCAL_NOTE_TARGET");
    expect(graph(invalid).notes).toEqual([]);
  });

  it.each([". note", "_ note", "point note", "edge note"])("retains literal descendants after invalid outline layout at %s", header => {
    const result = compile(`- [C] Outer.\n\t- [${header}] Bad indentation.\n    - [G +> @missing] Literal.`);
    expect(result.diagnostics.map(d => d.code)).toEqual(["TAB_INDENTATION_UNSUPPORTED", "MALFORMED_NOTE"]);
    expect(result.graphs[0].points).toHaveLength(1);
    expect(result.graphs[0].bearings).toEqual([]);
    expect(result.documents[0].blocks[0].children[0].children[0].annotation).toBeUndefined();
  });

  it("preserves source, targets and literal descendants through both complete exports and checked edits", () => {
    const source = "- [point @p] Original.\n- [C @q] Claim.\n  - [G use @p; @r] Local.\n    - [node note] Point text.\n    - [edge note] Here yesterday.\n      - [point @literal] Quotation.";
    const preview = previewExplicitTarget(source, { line: 3 });
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(graph(preview.proposedSource).notes).toEqual(graph(source).notes);
    const refs = analyzeSourceReferences(source);
    expect(refs.references.status).toBe("complete");
    if (refs.references.status === "complete") {
      expect(refs.references.units[0].map(n => n.name)).toEqual(["p", "q", "r"]);
      expect(refs.references.units[0][0].references.map(r => r.kind)).toEqual(["point-use"]);
    }
    for (const result of [compileSource(source), compile(source)]) {
      const exported = JSON.parse(JSON.stringify(result));
      expect(exported.units[0].source).toBe(source);
      expect(exported.graphs[0].notes).toHaveLength(2);
      expect(exported.documents[0].blocks[1].children[0].children[1].children[0].text).toBe("[point @literal] Quotation.");
    }
    expect(previewExplicitTarget(source, { line: 6 })).toMatchObject({ status: "unavailable", reason: "no-attachment" });
  });

  it("validates current exports, rejects illegal note fields and keeps published schemas intact", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const schemas = ["ast", "graph-ir", "explain", "source"].map(name =>
      JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8")));
    schemas.forEach(schema => ajv.addSchema(schema));
    const validate = ajv.getSchema(schemas[3].$id)!;
    const source = declarations + "\n  - [bearing note] Text.\n    - [point @literal] Literal.";
    const exported = JSON.parse(JSON.stringify(compile(source)));
    expect(validate(exported), JSON.stringify(validate.errors)).toBe(true);
    exported.graphs[0].notes[1].text = "A competing store.";
    expect(validate(exported)).toBe(false);
    const oldAst = JSON.parse(readFileSync(new URL("../../../spec/0.5.0/ast.schema.json", import.meta.url), "utf8"));
    expect(oldAst.properties.version.const).toBe("0.5.0");
    expect(new Ajv2020().compile(oldAst)(JSON.parse(JSON.stringify(parseDocument(source))))).toBe(false);
  });
});
