import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, explainSource, parseDocument } from "./index.js";
import type { AstBlock } from "./types.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const flatten = (blocks: AstBlock[]): AstBlock[] => blocks.flatMap(block => [block, ...flatten(block.children)]);

describe("literal note subtrees", () => {
  it("preserves every spelling before annotation parsing, name collection and graph construction", () => {
    const literal = ["[G @real] Quoted Ground.", "[note] Nested spelling.", "[linked; @route]", "[_ use @missing]", "[G +> @unknown]", "[G", "[]", "[C? @retired]", "[note @bad]", "[. @hidden]", "[use @missing]", "[scope @scope]"];
    const source = ["- [C @real] Claim.", "  - [note] Sources 😀", ...literal.map((text, index) => "    " + (index === 1 ? "  " : "") + "- " + text), "  - [G @visible; @route] Actual reason.", "- [. use @hidden] Outside."].join("\n");
    const ast = parseDocument(source);
    const note = ast.blocks[0].children[0];
    expect(flatten(note.children).map(block => block.text)).toEqual(literal);
    expect(flatten(note.children).every(block => !block.annotation)).toBe(true);
    expect(flatten(note.children).map(block => block.raw)).toEqual(source.split("\n").slice(2, 14));
    expect(note.children[0].children[0].text).toBe(literal[1]);
    expect(ast.diagnostics).toEqual([]);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(graph.points.map(point => point.id)).toEqual(["real", "visible"]);
    expect(graph.bearings).toEqual([expect.objectContaining({ handle: "route", sources: [{ kind: "point", key: "_p2" }], target: { kind: "point", key: "_p1" } })]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["UNKNOWN_POINT_REFERENCE"]);
    expect(explain.entries.map(entry => entry.sourceSpan.startLine)).toEqual([1, 2, 15, 16]);
    expect(explain.entries[1]).toMatchObject({ recognition: { kind: "note" }, effects: [{ kind: "preserveNote", parentSpan: ast.blocks[0].sourceSpan }] });
  });

  it.each(["[note]", "[ note ]"])("accepts empty %s and restores interpretation at dedent", header => {
    const { graph, explain } = compile("- " + header + "\n- [C] Claim.\n  - [note]\n  - [G] Ground.");
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points.map(point => point.text)).toEqual(["Claim.", "Ground."]);
    expect(explain.entries[0].effects).toEqual([{ kind: "preserveNote" }]);
    expect(graph.bearings[0].kind).toBe("supports");
  });

  it.each(["[note @alias]", "[note; @route]", "[NOTE]", "[note", "[note @alias", "[note@alias]"])("keeps malformed %s opaque and preserves independent siblings", header => {
    const { graph } = compile("- [C @c] Claim.\n  - " + header + "\n    - [G @hidden] Hidden.\n    - [G\n  - [G @g] Ground.\n  - [_ @g +> @c; @independent]");
    expect(graph.points.map(point => point.id)).toEqual(["c", "g"]);
    expect(graph.bearings).toHaveLength(2);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["MALFORMED_NOTE"]);
  });

  it.each(["[notebook]", "[note-like]", "\"[note]\"", "\\[note]"])("does not reserve prose %s", prose => {
    const ast = parseDocument("- [C] Claim.\n  - " + prose + "\n    - [G] Ground.");
    expect(ast.blocks[0].children[0].text).toBe(prose);
    expect(ast.blocks[0].children[0].annotation).toBeUndefined();
    expect(compileGraphWithExplain(ast).graph.bearings).toHaveLength(1);
  });

  it("uses the direct source parent for every placement and never imports remote notes", () => {
    const source = ["- [C @c] Claim.", "  - [note] Declaration detail.", "  - [G @g; @route] Reason.", "    - [note] Point AND attachment occurrence.", "  - [linked; @joint]", "    - [note] Linked detail.", "    - [G use @g] Inline Ground use prose.", "      - [note] Ground use detail.", "- [_ @g +> @c]", "  - [note] Explicit construction detail.", "- [_ use @route] Inline Bearing use prose.", "  - [note] Bearing use detail.", "- [. use @c] Inline Point use prose.", "  - [note] This use only.", "- Organisation", "  - [note] Body detail.", "- [note] Document detail."].join("\n");
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(graph.diagnostics).toEqual([]);
    const notes = explain.entries.filter(entry => entry.recognition.kind === "note");
    expect(notes.map(entry => entry.effects.find(effect => effect.kind === "preserveNote"))).toEqual([1, 3, 5, 7, 9, 11, 13, 15, undefined].map(line => line ? { kind: "preserveNote", parentSpan: flatten(ast.blocks).find(block => block.sourceSpan.startLine === line)!.sourceSpan } : { kind: "preserveNote" }));
    expect(notes[2].effects).toContainEqual({ kind: "linkedMember", linkedSpan: ast.blocks[0].children[2].sourceSpan, eligible: false, function: "supplementary" });
    expect(graph.points[0].text).toBe("Claim.");
    expect(ast.blocks[2].text).toBe("Inline Bearing use prose.");
    expect(ast.blocks[3].text).toBe("Inline Point use prose.");
    expect(graph.bearings[1].sources).toEqual([{ kind: "point", key: "_p2" }]);
  });

  it("excludes notes from ordered linked sources without flattening wrappers", () => {
    const valid = compile("- [C] Claim.\n  - [linked]\n    - [G @first] First.\n    - [note]\n      - [G @fake] Literal.\n    - [G @last] Last.");
    expect(valid.graph.diagnostics).toEqual([]);
    expect(valid.graph.bearings[0].sources).toEqual([{ kind: "point", key: "_p2" }, { kind: "point", key: "_p3" }]);
    for (const member of ["[note @bad]", "Ordinary body"]) {
      const invalid = compile("- [C] Claim.\n  - [linked]\n    - [G] First.\n    - " + member + "\n      - [G] Nested.");
      expect(invalid.graph.bearings).toEqual([]);
      expect(invalid.graph.diagnostics.map(diagnostic => diagnostic.code)).toContain("INVALID_LINKED_MEMBER");
    }
    expect(compile("- [C] Claim.\n  - [linked]\n    - [note]\n      - [G] Literal.").graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["EMPTY_LINKED"]);
  });

  it("retains UTF-16 locations in an indented host fence", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const source = "Host 😀\n  " + fence + "cog\n  - [C @c] 主張😀\n    - [note] 引用😀\n      - [G @c] 未完😀\n        - [G\n    - [G] 理由😀\n  " + fence;
    const result = explainSource(source, "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0].diagnostics).toEqual([]);
    const blocks = flatten(result.documents[0].blocks);
    for (const block of blocks) {
      const line = source.split("\n")[block.sourceSpan.startLine - 1];
      expect(block.sourceSpan.endColumn).toBe(line.length + 1);
      expect(line.slice(block.sourceSpan.startColumn - 1, block.sourceSpan.endColumn - 1)).toBe(block.annotation ? "[" + block.annotation.raw + "] " + block.text : block.text);
    }
    expect(blocks[2].text).toBe("[G @c] 未完😀");
    expect(result.explanations[0].entries.map(entry => entry.sourceSpan.startLine)).toEqual([3, 4, 7]);
  });

  it("retains layout errors inside literal notes", () => {
    expect(compile("- [note]\n\t- [G] Literal.").graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["TAB_INDENTATION_UNSUPPORTED"]);
  });
});
