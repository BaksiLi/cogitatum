import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileGraph, explainSource, parseDocument } from "./index.js";
import type { GraphIR, SourceParseMode } from "./types.js";

const ajv = new Ajv2020({ allErrors: true });
const schemas = ["ast", "graph-ir", "explain"].map((name) =>
  JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8"))
);
for (const schema of schemas) ajv.addSchema(schema);
const [validateAst, validateGraph, validateExplain] = schemas.map((schema) => ajv.getSchema(schema.$id)!);

function explainUnit(source: string, mode: SourceParseMode) {
  const input = mode === "host" ? `Host prose.\n\n\`\`\`cog\n${source}\n\`\`\`\n` : source;
  const result = explainSource(input, mode);
  return { ast: result.documents[0], graph: result.graphs[0], explain: result.explanations[0] };
}

function expectValidContracts(result: ReturnType<typeof explainUnit>) {
  expect(() => structuredClone(result)).not.toThrow();
  const json = JSON.parse(JSON.stringify(result));
  expect(validateAst(json.ast), JSON.stringify(validateAst.errors)).toBe(true);
  expect(validateGraph(json.graph), JSON.stringify(validateGraph.errors)).toBe(true);
  expect(validateExplain(json.explain), JSON.stringify(validateExplain.errors)).toBe(true);
}

function pointRef(graph: GraphIR, id: string) {
  const point = graph.points.find((point) => point.id === id);
  if (!point) throw new Error(`Expected Point @${id}.`);
  return { key: point.key, kind: "point" as const };
}

const malformedEdges = [
  ["[edge @g +> @c; @one; @two]", "MALFORMED_ANNOTATION"],
  ["[edge @g +> @c", "MALFORMED_ANNOTATION_PREFIX"],
  ["[Edge @g +> @c]", "MALFORMED_EXPLICIT_BEARING"],
  ["[EDGE @g +> @c]", "MALFORMED_EXPLICIT_BEARING"],
  ["[edge; @one; @two]", "MALFORMED_ANNOTATION"],
  ["[edge; @route]", "MALFORMED_EDGE_ANNOTATION"],
  ["[edge;", "MALFORMED_ANNOTATION_PREFIX"],
  ["[Edge @g", "MALFORMED_ANNOTATION_PREFIX"],
  ["[edge @g +> @c;]", "MALFORMED_BEARING_HANDLE"]
] as const;

describe("parser failure boundaries", () => {
  it.each([["\t", "document"], [" ", "document"], ["\t", "host"], [" ", "host"]] as const)("retains a failed annotation boundary at invalid indentation %j in %s", (indentation, mode) => {
    const result = explainUnit(
      `- [C @outer] Outer.\n` +
      `    - [C @sibling] Establish the active indentation.\n` +
      `${indentation}- [C @failed] Misindented Point.\n` +
      `      - [G @inner] Must not support outer.\n` +
      `        - [G @detail] Supports inner.\n` +
      `      - [G @independent +> @outer] Explicit relation survives.\n` +
      `- [G @after +> @outer] Recovered.`,
      mode
    );
    expect(result.ast.blocks[0].children[1]).toMatchObject({
      annotation: { kind: "invalid", raw: "C @failed" },
      text: "[C @failed] Misindented Point."
    });
    expect(result.graph.points.map(point => point.id)).toEqual(["outer", "sibling", "inner", "detail", "independent", "after"]);
    expect(result.graph.bearings).toEqual([
      expect.objectContaining({ sources: [pointRef(result.graph, "detail")], target: pointRef(result.graph, "inner") }),
      expect.objectContaining({ sources: [pointRef(result.graph, "independent")], target: pointRef(result.graph, "outer") }),
      expect.objectContaining({ sources: [pointRef(result.graph, "after")], target: pointRef(result.graph, "outer") })
    ]);
    expect(result.graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      indentation === "\t" ? "MIXED_INDENTATION" : "UNMATCHED_DEDENT",
      "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET"
    ]);
    expectValidContracts(result);
  });

  it("keeps misindented ordinary prose transparent and misindented notes literal", () => {
    const prose = explainUnit("- [C @outer] Outer.\n  - Spaces set the unit's indentation.\n\t- [O-ring] Ordinary prose.\n    - [G @inner] Ground.", "document");
    expect(prose.ast.blocks[0].children[1].annotation).toBeUndefined();
    expect(prose.graph.bearings).toEqual([expect.objectContaining({ target: pointRef(prose.graph, "outer") })]);
    const note = explainUnit("- [C @outer] Outer.\n  - Spaces set the unit's indentation.\n\t- [note] Literal.\n    - [G @outer] No duplicate.\n    - [use] No inner error.\n- [G @after +> @outer] Active again.", "document");
    expect(note.ast.blocks[0].children[1].annotation).toMatchObject({ kind: "note", syntaxErrors: ["note"] });
    expect(note.graph.points.map(point => point.id)).toEqual(["outer", "after"]);
    expect(note.graph.bearings).toHaveLength(1);
    expect(note.graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["MIXED_INDENTATION", "MALFORMED_NOTE"]);
    expectValidContracts(prose);
    expectValidContracts(note);
  });

  for (const mode of ["document", "host"] as const) {
    describe(`${mode} input`, () => {
      it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
        "does not accept the inherited object property %s as an operator",
        (token) => {
          const result = explainUnit(
            `- [C @c] Claim.\n- [G ${token} @c] Invalid reason.\n- [edge @c ${token} @c] Invalid edge.`,
            mode
          );
          expect(result.graph.points.map((point) => point.id)).toEqual(["c"]);
          expect(result.graph.bearings).toEqual([]);
          expect(result.graph.diagnostics.map((item) => item.code)).toEqual([
            "MALFORMED_ROLE_ANNOTATION", "MALFORMED_EDGE_ANNOTATION"
          ]);
          expectValidContracts(result);
        }
      );

      it.each(malformedEdges)("keeps the failed constructor %s as an edge boundary", (header, code) => {
        const result = explainUnit(
          `- [C @c] Outer claim.\n` +
          `  - ${header} Failed route.\n` +
          `    - Ordinary body inside the failed route.\n` +
          `      - [O @o] Do not attach this to the outer claim.\n` +
          `        - [G @detail] This still supports the objection Point.\n` +
          `      - [O @explicit -> @other; @independent] An independent objection.\n` +
          `        - [R @reply] This still replies to that objection.\n` +
          `- [G @g] A source Point.\n` +
          `- [C @other] Another claim.`,
          mode
        );
        const boundary = result.ast.blocks[0].children[0];
        expect(boundary.annotation).toMatchObject({ kind: "edge" });
        expect(boundary.annotation?.syntaxErrors?.length).toBeGreaterThan(0);
        expect(result.graph.points.map((point) => point.id)).toEqual([
          "c", "o", "detail", "explicit", "reply", "g", "other"
        ]);
        expect(result.graph.bearings).toEqual([
          expect.objectContaining({
            kind: "supports", sources: [pointRef(result.graph, "detail")], target: pointRef(result.graph, "o")
          }),
          expect.objectContaining({
            kind: "challenges", handle: "independent",
            sources: [pointRef(result.graph, "explicit")], target: pointRef(result.graph, "other")
          }),
          expect.objectContaining({
            kind: "repliesTo", sources: [pointRef(result.graph, "reply")], target: pointRef(result.graph, "explicit")
          })
        ]);
        expect(result.graph.diagnostics.map((item) => item.code)).toEqual([
          code, "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET"
        ]);
        expect(result.explain.entries.find((entry) => entry.sourceSpan.startLine === boundary.sourceSpan.startLine))
          .toMatchObject({
            recognition: { kind: "edge" },
            effects: [{ kind: "rejectBearing", reason: "annotation-syntax-error" }]
          });
        expectValidContracts(result);
      });
    });
  }

  it("preserves the four actual operators and their target contracts", () => {
    const result = explainUnit(
      "- [C @c] Claim.\n" +
      "- [G +> @c; @route] Support.\n" +
      "- [O -> @c] Challenge to the Point.\n" +
      "- [O /> @route] Challenge to the route.\n" +
      "- [? ~> @c] A gap about the claim.",
      "document"
    );
    expect(result.graph.diagnostics).toEqual([]);
    expect(result.graph.bearings.map((bearing) => [bearing.kind, bearing.target.kind])).toEqual([
      ["supports", "point"], ["challenges", "point"], ["challenges", "bearing"], ["about", "point"]
    ]);
    expectValidContracts(result);
  });

  it("does not derive a direct child's default connection through a failed edge", () => {
    const result = explainUnit(
      "- [C @c] Outer claim.\n  - [edge; @one; @two]\n    - [O @o] Objection.",
      "document"
    );
    expect(result.graph.points.map((point) => point.id)).toEqual(["c", "o"]);
    expect(result.graph.bearings).toEqual([]);
    expect(result.graph.diagnostics.map((item) => item.code)).toEqual([
      "MALFORMED_ANNOTATION", "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET"
    ]);
    expectValidContracts(result);
  });

  it.each(["[edgeless]", "[edgewise @note]", "[Edges]", "[edgeless"])(
    "keeps the non-keyword prose prefix %s transparent",
    (prefix) => {
      const content = `${prefix} Ordinary body.`;
      const result = explainUnit(`- [C @c] Claim.\n  - ${content}\n    - [O @o] Objection.`, "document");
      expect(result.ast.blocks[0].children[0]).toMatchObject({ text: content, annotation: undefined });
      expect(result.graph.bearings).toEqual([
        expect.objectContaining({ kind: "challenges", sources: [pointRef(result.graph, "o")], target: pointRef(result.graph, "c") })
      ]);
      expect(result.graph.diagnostics).toEqual([expect.objectContaining({ code: "IMPLICIT_ATTACHMENT_THROUGH_BODY", severity: "suggestion" })]);
      expectValidContracts(result);
    }
  );

  it("uses the retained annotation, without reparsing a failed edge's raw text during compilation", () => {
    const ast = parseDocument("- [C @c] Claim.\n  - [Edge @g +> @c]\n    - [O @o] Objection.");
    const boundary = ast.blocks[0].children[0];
    const raw = boundary.raw;
    expect(boundary.annotation?.kind).toBe("edge");
    expect(compileGraph(ast).bearings).toEqual([]);
    delete boundary.annotation;
    const graph = compileGraph(ast);
    expect(graph.bearings).toEqual([
      expect.objectContaining({ kind: "challenges", sources: [pointRef(graph, "o")], target: pointRef(graph, "c") })
    ]);
    expect(boundary.raw).toBe(raw);
  });

  it("does not reinterpret trailing prose as an unclosed edge constructor", () => {
    const result = explainUnit(
      "- [C @c] Claim.\n  - [G invalid] [edge\n    - [O @o] Objection.",
      "document"
    );
    expect(result.ast.blocks[0].children[0]).toMatchObject({ text: "[edge", annotation: { kind: "invalid", raw: "G invalid" } });
    expect(result.graph.bearings).toEqual([]);
    expect(result.graph.diagnostics.map((item) => item.code)).toEqual(["MALFORMED_ROLE_ANNOTATION", "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET"]);
    expectValidContracts(result);
  });
});
