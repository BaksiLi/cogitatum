import { describe, expect, it } from "vitest";
import { explainSource, tokenizeSource } from "./index.js";
import type { AstBlock } from "./types.js";

const compile = (source: string, mode: "document" | "host" = "document") => {
  const compiled = explainSource(source, mode);
  return { compiled, graph: compiled.graphs[0], blocks: compiled.documents[0].blocks, codes: compiled.diagnostics.map(d => d.code) };
};
const kinds = (blocks: AstBlock[]): unknown[] => blocks.map(b => [b.annotation?.kind ?? "body", ...(b.children.length ? [kinds(b.children)] : [])]);

describe("an annotation's closing bracket is followed by whitespace or the end of the line", () => {
  it.each([
    ["a space", "- [G] Good evidence.", "Good evidence."],
    ["a tab", "- [G]\tGood evidence.", "Good evidence."],
    ["U+00A0", "- [G]\u00a0去年展會免費接駁。", "去年展會免費接駁。"],
    ["U+3000", "- [G]\u3000去年展會免費接駁。", "去年展會免費接駁。"],
    ["the end of the line", "- [G]\n- [C] Next.", ""],
    ["the end of the file", "- [G]", ""],
    ["a CRLF line ending", "- [G]\r\n- [C] Next.", ""]
  ])("accepts %s", (_label, source, text) => {
    const { graph, codes } = compile(source);
    expect(codes).toEqual([]);
    // The separator is not part of the body.
    expect(graph.points[0]).toMatchObject({ declaration: { form: "role", role: "G" }, text });
  });

  it.each([
    ["a mark", "- [G]ood evidence."],
    ["CJK prose", "- [G]去年展會免費接駁。"],
    ["a named Point", "- [G @x]ood evidence."],
    ["an explicit clause", "- [C @c] Claim.\n- [O +> @c]Text."],
    ["a handle", "- [C @c] Claim.\n- [G @x +> @c; @r]Text."],
    ["a selector", "- [C @c] Claim.\n  - [G @g] Ground.\n    - [O/]Text."],
    ["a Point use", "- [C @c] Claim.\n- [C @d] Other.\n  - [G use @c]Text."],
    ["a long family spelling", "- [point @x]Text."],
    ["a Bearing use", "- [C @c] Claim.\n  - [G @g; @r] Ground.\n- [_ use @r]Text."],
    ["punctuation", "- [G]. Text."],
    ["another bracket", "- [G][1] Text."]
  ])("diagnoses %s glued to the bracket, without accepting or repairing it", (_label, source) => {
    const { compiled, graph, codes } = compile(source);
    expect(codes).toEqual(["MISSING_ANNOTATION_SEPARATOR"]);
    const line = source.split("\n").length;
    const failed = compiled.explanations[0].entries.find(e => e.sourceSpan.startLine === line)!;
    expect(failed.diagnosticCodes).toEqual(["MISSING_ANNOTATION_SEPARATOR"]);
    expect(failed.effects.some(e => e.kind === "emitPoint" || e.kind === "emitBearing" || e.kind === "preserveBody")).toBe(false);
    // No character is dropped: the block keeps its whole header as text.
    const last = (blocks: AstBlock[]): AstBlock => { const b = blocks[blocks.length - 1]; return b.children.length ? last(b.children) : b; };
    expect(source.endsWith(last(compiled.documents[0].blocks).text)).toBe(true);
    expect(last(compiled.documents[0].blocks).text.startsWith("[")).toBe(true);
    expect(graph.points.some(p => p.id === "x")).toBe(false);
  });

  it.each([
    ["- [Context]word"], ["- [O-ring]erosion"], ["- Text: [G]ood"], ["- [I]n 1990"], ["- ［G］ 全形括號。"], ["- [edgeless]ly"], ["- \\[G]ood"]
  ])("leaves %s as ordinary body", source => {
    const { graph, blocks, codes } = compile(source);
    expect(codes).toEqual([]);
    expect(kinds(blocks)).toEqual([["body"]]);
    expect(graph.points).toEqual([]);
  });

  it("keeps the failure boundary: descendants cannot attach outward, independent content survives", () => {
    const { graph, codes } = compile([
      "- [C @outer] Outer claim.",
      "  - [G]ood",
      "    - [G @inner] A retained child Point.",
      "      - [O @objection] An objection to that child.",
      "    - [. @independent +> @outer] An independently stated support."
    ].join("\n"));
    expect(codes).toEqual(["MISSING_ANNOTATION_SEPARATOR", "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET"]);
    const id = (key: string) => graph.points.find(p => p.key === key)?.id;
    expect(graph.bearings.map(b => [b.kind, id(b.sources[0].key), id(b.target.key)])).toEqual([
      ["challenges", "objection", "inner"], ["supports", "independent", "outer"]
    ]);
  });

  it("keeps a malformed note's subtree literal", () => {
    const { graph, blocks, codes } = compile("- [C @c] Claim.\n  - [note]Quoted passage.\n    - [G] This remains literal quoted content.\n  - [. note]也一樣。\n    - [O] 字面內容。");
    expect(codes).toEqual(["MISSING_ANNOTATION_SEPARATOR", "MISSING_ANNOTATION_SEPARATOR"]);
    expect(kinds(blocks)).toEqual([["role", [["note", [["body"]]], ["note", [["body"]]]]]]);
    expect(graph).toMatchObject({ points: [{ id: "c" }], bearings: [], notes: [] });
  });

  it("keeps a glued constructor's member boundary without further noise", () => {
    const { graph, codes } = compile("- [C @c] Claim.\n  - [_ +> ^]Joint.\n    - [. @a] First.\n    - [. @b] Second.");
    expect(codes).toEqual(["MISSING_ANNOTATION_SEPARATOR"]);
    expect(graph.bearings).toEqual([]);
    expect(graph.points.map(p => p.id)).toEqual(["c", "a", "b"]);
  });

  it("applies inside active fences of a host document and leaves host prose alone", () => {
    const { compiled } = compile("[G]ood host prose.\n\n```cog\n- [G]去年展會免費接駁。\n- [G] 去年展會免費接駁。\n```\n", "host");
    expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "MISSING_ANNOTATION_SEPARATOR", sourceSpan: expect.objectContaining({ startLine: 4, startColumn: 3 }) })]);
    expect(compiled.graphs[0].points).toHaveLength(1);
  });

  it("is tokenized as the parser reads it", () => {
    const [glued, spaced, note, literal] = tokenizeSource("- [G]ood\n- [G] Good\n- [note]Quoted\n  - [G] literal");
    expect(glued.tokens.some(t => t.annotation)).toBe(false);
    expect(glued.tokens.map(t => t.text).join("")).toBe("- [G]ood");
    expect(spaced.role).toBe("G");
    expect(note.tokens.some(t => t.annotation)).toBe(false);
    expect(literal.note).toBe(true);
  });
});

describe("the node and edge family aliases are retired", () => {
  it.each([
    ["[node]", "- [node] Text."],
    ["[node @p]", "- [node @p] Text."],
    ["[node use @p]", "- [. @p] Text.\n- [node use @p]"],
    ["[node @x +> @p]", "- [. @p] Text.\n- [node @x +> @p] Reason."],
    ["[edge +> ^]", "- [C @c] Claim.\n  - [edge +> ^]\n    - [. @a] Member."],
    ["[edge @a +> @c]", "- [C @c] Claim.\n- [. @a] Material.\n- [edge @a +> @c; @r]"],
    ["[edge use @r]", "- [C @c] Claim.\n  - [G @g; @r] Ground.\n- [edge use @r]\n  - [O/ @o] Objection."],
    ["[edge/]", "- [C @c] Claim.\n  - [G @g; @r] Ground.\n    - [edge/]\n      - [. @a] Member."],
    ["[edge]", "- [C @c] Claim.\n  - [edge]\n    - [. @a] Member."],
    ["wrong case", "- [C @c] Claim.\n- [. @a] Material.\n- [Edge @a +> @c]"],
    ["wrong case Point", "- [Node @p] Text."],
    ["[edge cases]", "- [edge cases] are hard."],
    ["[node graph]", "- [node graph] of the system."],
    ["an unclosed constructor", "- [C @c] Claim.\n  - [edge +> ^\n    - [. @a] Member."],
    ["an unclosed use", "- [. @p] Text.\n- [node use @p"]
  ])("diagnoses %s once, with no Bearing and no fallback", (_label, source) => {
    const before = compile(source.replace(/\[(node|Node)/g, "[.").replace(/\[(edge|Edge)/g, "[_"));
    const { graph, codes } = compile(source);
    expect(codes.filter(code => code === "RETIRED_FAMILY_ALIAS")).toHaveLength(1);
    // Nothing the retired header would have authored is constructed, and nothing replaces it.
    const line = source.split("\n").findIndex(l => /\[(node|edge)/i.test(l)) + 1;
    expect(graph.bearings.filter(b => b.sourceSpan?.startLine === line)).toEqual([]);
    expect(graph.bearings.length).toBeLessThanOrEqual(before.graph.bearings.length);
    expect(graph.bearings.every(b => before.graph.bearings.some(e => e.kind === b.kind && e.sourceSpan?.startLine === b.sourceSpan?.startLine))).toBe(true);
  });

  it("names the replacement spelling without rewriting source", () => {
    const { compiled } = compile("- [C @c] Claim.\n  - [edge +> ^; @route]\n    - [node @a] Member.");
    expect(compiled.diagnostics.map(d => d.message)).toEqual([
      expect.stringContaining("write _ or bearing. Migrate this annotation to [_ +> ^; @route]"),
      expect.stringContaining("write . or point. Migrate this annotation to [. @a]")
    ]);
    expect(compiled.documents[0].blocks[0].children[0].annotation).toMatchObject({ kind: "bearing", members: true, raw: "edge +> ^; @route", syntaxErrors: ["retired"] });
  });

  it("keeps the boundary of a retired constructor: descendants do not attach to an outer Point", () => {
    const { graph, codes } = compile("- [C @outer] Outer.\n  - [edge @x +> @outer]\n    - [G @inner] Would have needed a target anyway.\n- [. @x] Material.");
    expect(codes).toEqual(["RETIRED_FAMILY_ALIAS", "EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET"]);
    expect(graph.bearings).toEqual([]);
  });

  it("keeps retired notes literal", () => {
    const { graph, blocks, codes } = compile("- [C @c] Claim.\n  - [node note] Reading.\n    - [G] Literal.\n  - [edge note] Step.\n    - [O] Literal.");
    expect(codes).toEqual(["RETIRED_FAMILY_ALIAS", "RETIRED_FAMILY_ALIAS"]);
    expect(kinds(blocks)).toEqual([["role", [["note", [["body"]]], ["note", [["body"]]]]]]);
    expect(graph).toMatchObject({ points: [{ id: "c" }], bearings: [], notes: [] });
  });

  it.each(["- [edgeless] graphs", "- [nodes] and links", "- [edge-case] handling", "- [node.js] version"])("leaves %s as ordinary body", source => {
    const { blocks, codes } = compile(source);
    expect(codes).toEqual([]);
    expect(kinds(blocks)).toEqual([["body"]]);
  });

  it("keeps the long spellings point and bearing exactly equivalent to . and _", () => {
    const short = "- [C @c] Claim.\n- [. @a] Material.\n  - [. note] Reading.\n- [_ @a +> @c; @r]\n  - [_ note] Step.\n- [_ use @r]\n  - [O/ @o] Objection.\n- [. use @a +> @c]";
    const long = short.replace(/\[\./g, "[point").replace(/\[_/g, "[bearing");
    const strip = (source: string) => { const { graph, codes } = compile(source); return { codes, points: graph.points.map(p => [p.id, p.declaration]), bearings: graph.bearings.map(b => [b.kind, b.handle, b.sources, b.target]), notes: graph.notes.map(n => [n.origin, n.target]) }; };
    expect(strip(long)).toEqual(strip(short));
    expect(strip(long).codes).toEqual([]);
  });

  it("highlights the aliases as retired", () => {
    const [node, edge] = tokenizeSource("- [node @p] Text.\n- [edge @p +> @p]");
    expect(node.tokens.find(t => t.text === "node")?.kind).toBe("retired");
    expect(edge.tokens.find(t => t.text === "edge")?.kind).toBe("retired");
  });
});
