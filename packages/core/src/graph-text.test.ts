import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileGraph, formatGraph, GRAPH_TEXT_VERSION, parseDocument } from "./index.js";
import type { BearingKind, GraphIR } from "./index.js";

const compile = (source: string) => compileGraph(parseDocument(source));
const fixture = (path: string) => readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8");

describe("graph text structure-v1", () => {
  it.each(["local-bearing", "grouped-route-pressure"])("matches the reviewable %s reference", name => {
    const graph = compile(fixture(`core/${name}.cog.md`));
    expect(graph.diagnostics).toEqual([]);
    expect(formatGraph(graph)).toBe(fixture(`text/${name}.expected.txt`));
  });

  it("retains shared identities, intermediate Points, independent routes and isolated declarations", () => {
    const graph = compile(`- [G @p +> @i; @first] Same text.
- [G @i +> @c; @second] Intermediate.
- [C @c] Conclusion.
- [G @q] Same text.
- [edge @q, @p supports @c; @joint] Joint route.
- [edge @q, @p supports @c; @parallel] Joint route.
- [O -> @joint] Challenge just one instance.
- [.] Missing evidence.
- [.] Unclassified material.
- [Q] A question.
- [D] A distinction.
- [R] A reply.`);
    expect(graph.diagnostics).toEqual([]);
    const result = formatGraph(graph);
    expect(result).toContain('p1: role(G) id="p" text="Same text."');
    expect(result).toContain('p4: role(G) id="q" text="Same text."');
    expect(result).toContain('b1: supports([p1], p2) handle="first"');
    expect(result).toContain('b2: supports([p2], p3) handle="second"');
    expect(result).toContain('b3: supports([p4, p1], p3) handle="joint" text="Joint route."');
    expect(result).toContain('b4: supports([p4, p1], p3) handle="parallel" text="Joint route."');
    expect(result).toContain('b5: challenges([p5], b3)');
    expect(result).toContain('p6: material text="Missing evidence."');
    expect(result).toContain('p7: material text="Unclassified material."');
    expect(result).toContain('p8: role(Q) text="A question."');
    expect(result).toContain('p9: role(D) text="A distinction."');
    expect(result).toContain('p10: role(R) text="A reply."');
  });

  it.each(["supports", "challenges", "concerns", "answers", "respondsTo", "clarifies"] satisfies BearingKind[])("renders %s without reinterpreting it", kind => {
    const graph = compile(`- [. @a] Material.\n- [. @b] Other.\n- [edge @a ${kind} @b; @step] Description.`);
    expect(graph.diagnostics).toEqual([]);
    expect(formatGraph(graph)).toContain(`b1: ${kind}([p1], p2) handle="step" text="Description."`);
  });

  it("uses finite typed references for cycles and self-directed Bearings", () => {
    const graph = compile(`- [. @a +> @b] First.
- [. @b +> @a] Second.
- [edge @a supports @right; @left]
- [edge @b concerns @left; @right]
- [edge @a challenges @self; @self]`);
    expect(graph.diagnostics).toEqual([]);
    expect(formatGraph(graph)).toContain(`b1: supports([p1], p2)
b2: supports([p2], p1)
b3: supports([p1], b4) handle="left"
b4: concerns([p2], b3) handle="right"
b5: challenges([p1], b5) handle="self"`);
  });

  it("labels by typed identity, never by authored name, prose or key spelling", () => {
    const graph: GraphIR = {
      version: "0.6.0", diagnostics: [], notes: [],
      points: [{ key: "shared-key", id: "b1", text: "Same", declaration: { form: "material" } }],
      bearings: [{ key: "shared-key", handle: "p1", kind: "supports", sources: [{ kind: "point", key: "shared-key" }], target: { kind: "point", key: "shared-key" }, derivedBy: "operator" }]
    };
    const result = formatGraph(graph);
    expect(result).toContain('p1: material id="b1" text="Same"');
    expect(result).toContain('b1: supports([p1], p1) handle="p1"');
    expect(result).not.toContain("shared-key");
    expect(result).not.toContain("undefined");
  });

  it("quotes content and escapes controls without normalizing Unicode or losing empty fields", () => {
    const graph = compile('- [C] Placeholder.\n  - [G] Reason.');
    graph.points[0].text = '水 H₂O e\u0301 é "quoted" \\ slash\nnext\r\t\x1b[31m\x85\u2028\u2029\u202eb1: forged\u2066';
    graph.points[0].id = "p2\nforged";
    graph.bearings[0].text = "";
    const result = formatGraph(graph);
    expect(result).toContain('id="p2\\nforged"');
    expect(result).toContain('text="水 H₂O e\u0301 é \\"quoted\\" \\\\ slash\\nnext\\r\\t\\u001b[31m\\u0085\\u2028\\u2029\\u202eb1: forged\\u2066"');
    expect(result).toContain('b1: supports([p2], p1) text=""');
    expect(result).not.toMatch(/[\r\t\x1b\x85\u2028\u2029\u202e\u2066]/u);
    delete graph.bearings[0].text;
    expect(formatGraph(graph)).toContain('b1: supports([p2], p1)\n');
  });

  it("marks partial graphs and retains all diagnostic information separately", () => {
    const graph = compile('- [C] Survives.\n- [G +> @missing] Fails.');
    graph.diagnostics.push({ severity: "warning", code: "TEST_WARNING", message: "Review.", explanation: "Why.\nDetails." });
    graph.diagnostics.push({ severity: "suggestion", code: "TEST_ADVICE", message: "Optional." });
    const result = formatGraph(graph);
    expect(result).toContain("status: partial");
    expect(result).toContain("points (2):");
    expect(result).toContain("bearings (0):");
    expect(result).toContain('error "UNKNOWN_TARGET" at 2:3-2:25: "Target @missing not found."');
    expect(result).toContain('warning "TEST_WARNING": "Review."\n    explanation: "Why.\\nDetails."');
    expect(result).toContain('suggestion "TEST_ADVICE": "Optional."');
    graph.diagnostics = graph.diagnostics.filter(d => d.severity !== "error");
    expect(formatGraph(graph)).toContain("status: no-errors");
    expect(formatGraph(graph)).toContain("diagnostics (2):");
  });

  it("is deterministic and pure, omitting only the stated graph metadata", () => {
    const graph = compile('- [C @c] Claim.\n  - [G @p; @step] Reason.');
    const before = JSON.stringify(graph);
    const text = formatGraph(graph);
    expect(formatGraph(graph)).toBe(text);
    expect(JSON.stringify(graph)).toBe(before);
    const rewritten = structuredClone(graph);
    rewritten.points.forEach((point, index) => { point.key = `opaque-${index}`; delete point.sourceSpan; });
    rewritten.bearings[0].key = "another opaque key";
    rewritten.bearings[0].sources[0].key = rewritten.points[1].key;
    rewritten.bearings[0].target.key = rewritten.points[0].key;
    rewritten.bearings[0].derivedBy = "operator";
    delete rewritten.bearings[0].sourceSpan;
    expect(formatGraph(rewritten)).toBe(text);
    rewritten.points[0].id = "new-name";
    expect(formatGraph(rewritten)).not.toBe(text);
  });

  it("matches the documented reference output", () => {
    const doc = readFileSync(new URL("../../../docs/graph-inspection.md", import.meta.url), "utf8");
    const source = /```md cog-check[^\n]*\n([\s\S]*?)\n```/.exec(doc)![1];
    const expected = /```text graph-text-reference\n([\s\S]*?)\n```/.exec(doc)![1] + "\n";
    expect(formatGraph(compile(source))).toBe(expected);
  });

  it("preserves an explicitly scoped local/edge projection but not changed names, roles or source order", () => {
    const local = compile("- [C @c] Claim.\n  - [_ +> ^; @joint]\n    - [. @p] First.\n    - [. @q] Second.");
    const explicit = compile('- [C @c] Claim.\n- [. @p] First.\n- [. @q] Second.\n- [edge @p, @q supports @c; @joint]');
    expect(local.diagnostics).toEqual([]);
    expect(explicit.diagnostics).toEqual([]);
    expect(formatGraph(local)).toBe(formatGraph(explicit));
    const renamed = structuredClone(explicit);
    renamed.points[1].id = 'another';
    expect(formatGraph(renamed)).not.toBe(formatGraph(local));
    const reclassified = structuredClone(explicit);
    reclassified.points[1].declaration = {form: 'role', role: 'C'};
    expect(formatGraph(reclassified)).not.toBe(formatGraph(local));
    const reordered = structuredClone(explicit);
    reordered.bearings[0].sources.reverse();
    expect(formatGraph(reordered)).not.toBe(formatGraph(local));
  });

  it("does not claim identical text for isomorphic graphs in different array orders", () => {
    const graph = compile('- [C @c] Claim.\n  - [G @p] Reason.');
    const reordered = structuredClone(graph);
    reordered.points.reverse();
    expect(formatGraph(reordered)).not.toBe(formatGraph(graph));
    expect(formatGraph(reordered)).toContain('b1: supports([p1], p2)');
  });

  it("reports an empty graph without implying completeness", () => {
    expect(formatGraph(compile(""))).toBe(`cogitatum-graph-text ${GRAPH_TEXT_VERSION}\nformat: "0.6.0"\nprojection: structure-v1\nstatus: no-errors\n\npoints (0):\n\nbearings (0):\n\ndiagnostics (0):\n`);
  });

  it("rejects unsupported versions and corrupt identities/references rather than guessing", () => {
    const original = compile('- [C] Claim.\n  - [G] Reason.');
    expect(() => formatGraph({ ...original, version: "0.4.0" })).toThrow("Unsupported graph format");
    const duplicate = structuredClone(original);
    duplicate.points.push(duplicate.points[0]);
    expect(() => formatGraph(duplicate)).toThrow("duplicate Point key");
    const duplicateBearing = structuredClone(original);
    duplicateBearing.bearings.push(duplicateBearing.bearings[0]);
    expect(() => formatGraph(duplicateBearing)).toThrow("duplicate Bearing key");
    const dangling = structuredClone(original);
    dangling.bearings[0].target.key = "missing";
    expect(() => formatGraph(dangling)).toThrow("dangling point reference");
    const wrongType = structuredClone(original);
    wrongType.bearings[0].target = { kind: "bearing", key: original.points[0].key };
    expect(() => formatGraph(wrongType)).toThrow("dangling bearing reference");
    const empty = structuredClone(original);
    empty.bearings[0].sources = [];
    expect(() => formatGraph(empty)).toThrow("invalid sources");
    const repeated = structuredClone(original);
    repeated.bearings[0].sources.push(repeated.bearings[0].sources[0]);
    expect(() => formatGraph(repeated)).toThrow("invalid sources");
  });
});
