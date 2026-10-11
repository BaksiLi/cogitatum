import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  compileGraph,
  compileGraphWithExplain,
  compileSource,
  explainSource,
  parseDocument,
  parseSource
} from "./index.js";

const ajv = new Ajv2020({ allErrors: true });
const schema = (name: string) => JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8"));
const astSchema = schema("ast");
const graphSchema = schema("graph-ir");
const explainSchema = schema("explain");
const sourceSchema = schema("source");
for (const contract of [astSchema, graphSchema, explainSchema]) ajv.addSchema(contract);
const validateAst = ajv.getSchema(astSchema.$id)!;
const validateGraph = ajv.getSchema(graphSchema.$id)!;
const validateExplain = ajv.getSchema(explainSchema.$id)!;
const validateSource = ajv.compile(sourceSchema);
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("public compiler contract boundaries", () => {
  it("validates typed Bearing focus and selection without admitting construction fields on use", () => {
    const declarations = "- [C @p] Premise.\n- [C @c] Claim.\n- [_ @p +> @c; @route] Route.";
    for (const suffix of ["\n- [_ use @route] Note.\n  - [G/] Warrant.\n  - [O/] Objection.", "\n- [_ use @p]\n  - [G/] Wrong focus.", "\n- [_ use @missing] Unknown.", "\n- [_ use @route; @alias] Invalid alias.", "\n- [_ use @route _> @c] Retired suffix.", "\n- [_ use @route"]) {
      const ast = parseDocument(declarations + suffix);
      const { graph, explain } = compileGraphWithExplain(ast);
      expect(validateAst(json(ast)), JSON.stringify(validateAst.errors)).toBe(true);
      expect(validateGraph(json(graph)), JSON.stringify(validateGraph.errors)).toBe(true);
      expect(validateExplain(json(explain)), JSON.stringify(validateExplain.errors)).toBe(true);
    }
    const original = json(parseDocument(declarations + "\n- [_ use @route] Note."));
    expect(validateAst(original)).toBe(true);
    const missingOperand = structuredClone(original);
    delete missingOperand.blocks[3].annotation.ref;
    expect(validateAst(missingOperand)).toBe(false);
    const diagnosedMissingOperand = json(parseDocument("- [_ use] Missing operand."));
    expect(diagnosedMissingOperand.blocks[0].annotation).toMatchObject({ kind: "bearingUse", syntaxErrors: ["reference"] });
    expect(diagnosedMissingOperand.diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toContain("MALFORMED_BEARING_USE");
    expect(validateAst(diagnosedMissingOperand)).toBe(true);
    for (const ast of [structuredClone(original), missingOperand]) {
      ast.blocks[3].annotation.syntaxErrors = [];
      expect(validateAst(ast)).toBe(false);
    }
    for (const field of ["anchor", "handle", "role", "operatorClause"]) {
      const invalid = structuredClone(original);
      invalid.blocks[3].annotation[field] = field === "operatorClause" ? { op: "supports", sources: "self", target: { id: "c" } } : "alias";
      expect(validateAst(invalid), field).toBe(false);
    }
    const invalidExplain = json(compileGraphWithExplain(original).explain);
    invalidExplain.entries[3].effects[0].ref.kind = "point";
    expect(validateExplain(invalidExplain)).toBe(false);
  });

  it("validates distinct use operands, local focus effects, and rejected uses", () => {
    for (const source of [
      "- [.] Anonymous neutral.\n- [. @named] Named neutral.\n- [_ @named supports @named] Explicit self-support.",
      "- [C @claim] Claim.\n  - [G_] Retired selector.\n- [@old] Retired declaration.\n- [use @claim] Retired use.",
      "- [. @source] Source.\n- [C @claim] Claim.\n- [_ @source +> @claim; @route]\n- [O _> @route] Retired operator.",
      "- [C? @premise] Original.\n- [C @claim] Claim.\n  - [G use @premise; @step] Local prose.\n    - [O/ use @premise] Assessment.",
      "- [. use @missing] Unknown.\n  - [G] Valid child.",
      "- [C? use @missing] Unsupported status.",
      "- [G use @missing",
      "- [O/ use @missing /> @route] Excluded combination."
    ]) {
      const ast = parseDocument(source);
      const { graph, explain } = compileGraphWithExplain(ast);
      expect(validateAst(json(ast)), source).toBe(true);
      expect(validateGraph(json(graph)), source).toBe(true);
      expect(validateExplain(json(explain)), source).toBe(true);
    }
    const invalid = json(parseDocument("- [. use @point] Local prose."));
    invalid.blocks[0].annotation.anchor = "point";
    expect(validateAst(invalid)).toBe(false);
    delete invalid.blocks[0].annotation.anchor;
    invalid.blocks[0].annotation.status = "open";
    expect(validateAst(invalid)).toBe(false);
  });

  it("validates retained selector syntax and owned attachment explanations", () => {
    const ast = parseDocument("- [C @claim] Claim.\n  - [linked]\n    - [G] Premise.\n    - [G/] Warrant.\n    - [O/] Objection.\n      - [R] Reply.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(graph.diagnostics).toEqual([]);
    expect(validateAst(json(ast))).toBe(true);
    expect(validateGraph(json(graph))).toBe(true);
    expect(validateExplain(json(explain))).toBe(true);
    const invalid = json(ast);
    invalid.blocks[0].children[0].children[1].annotation.role = "Q";
    expect(validateAst(invalid)).toBe(false);
    const malformed = parseDocument("- [C] Claim.\n  - [G] Ground.\n    - [O/ /> @missing] Excluded combination.");
    const result = compileGraphWithExplain(malformed);
    expect(validateAst(json(malformed))).toBe(true);
    expect(validateExplain(json(result.explain))).toBe(true);
  });

  it("validates failed Point annotations as retained source boundaries", () => {
    const ast = parseDocument("- [C @outer] Outer.\n  - [O?] Invalid.\n    - [G] Valid child.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(validateAst(json(ast))).toBe(true);
    expect(validateGraph(json(graph))).toBe(true);
    expect(validateExplain(json(explain))).toBe(true);
  });

  it("validates all named edge kinds without admitting those clauses on Point annotations", () => {
    for (const kind of ["supports", "challenges", "undercuts", "about", "answers", "repliesTo", "clarifies"]) {
      const target = kind === "undercuts" ? "route" : "claim";
      const source = "- [C? @claim] Claim.\n- [. @material] Material.\n- [edge @material supports @claim; @route]\n- [edge @claim " + kind + " @" + target + "]";
      const ast = parseDocument(source);
      const { graph, explain } = compileGraphWithExplain(ast);
      expect(graph.diagnostics, kind).toEqual([]);
      expect(validateAst(json(ast)), kind).toBe(true);
      expect(validateGraph(json(graph)), kind).toBe(true);
      expect(validateExplain(json(explain)), kind).toBe(true);
      const fence = String.fromCharCode(96).repeat(3);
      expect(validateSource(json(explainSource(fence + "cog\n" + source + "\n" + fence, "host"))), kind).toBe(true);
    }
    const self = json(parseDocument("- [C @claim] Claim.\n- [G +> @claim] Ground."));
    for (const kind of ["answers", "repliesTo", "clarifies"]) {
      self.blocks[1].annotation.operatorClause.op = kind;
      expect(validateAst(self), kind).toBe(false);
    }
  });

  it("compiles the annotation as the sole semantic source and leaves raw text untouched", () => {
    const ast = parseDocument("- [C @claim] A claim.\n  - [G @reason] A reason.\n");
    const reason = ast.blocks[0].children[0];
    const raw = reason.raw;
    if (reason.annotation?.kind !== "role") throw new Error("Expected a role annotation.");
    reason.annotation.role = "O";
    reason.annotation.anchor = "objection";
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(graph.points[1]).toMatchObject({ id: "objection", role: "O" });
    expect(graph.bearings[0].kind).toBe("challenges");
    expect(explain.entries[1].recognition).toEqual({ kind: "role", role: "O" });
    expect(reason.raw).toBe(raw);
    expect(validateAst(json(ast))).toBe(true);

    delete reason.annotation;
    expect(compileGraph(ast).points).toHaveLength(1);
    expect(compileGraph(ast).bearings).toEqual([]);
    expect(compileGraphWithExplain(ast).explain.entries[1].recognition).toEqual({ kind: "body" });
  });

  it("validates linked blocks and their recovery/trace variants without admitting Point or operator fields", () => {
    for (const header of ["[linked; @route]", "[linked; @route] 說明這一步。", "[linked;]", "[linked; @a; @b]", "[Linked]", "[linked", "[join; @route]", "[join;]", "[JOIN]", "[join"]) {
      const ast = parseDocument(`- [C @c] Target.\n  - ${header}\n    - [G @a] First.\n    - [G @b] Second.`);
      const { graph, explain } = compileGraphWithExplain(ast);
      expect(validateAst(json(ast)), header).toBe(true);
      expect(validateGraph(json(graph)), header).toBe(true);
      expect(validateExplain(json(explain)), header).toBe(true);
      expect(validateSource(json(explainSource(`\`\`\`cog\n- [C] Target.\n  - ${header}\n    - [G] First.\n\`\`\``, "host"))), header).toBe(true);
      const invalid = json(ast);
      invalid.blocks[0].children[0].annotation.anchor = "fake-point";
      expect(validateAst(invalid)).toBe(false);
      delete invalid.blocks[0].children[0].annotation.anchor;
      invalid.blocks[0].children[0].annotation.operatorClause = { op: "supports", sources: "self", target: { id: "c" } };
      expect(validateAst(invalid)).toBe(false);
    }
    const ast = parseDocument("- [C] Target.\n  - [linked]\n    - [G] First.");
    // Compiler semantics belong to annotation, not retained raw source.
    const raw = ast.blocks[0].children[0].raw;
    delete ast.blocks[0].children[0].annotation;
    const graph = compileGraph(ast);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].sources).toHaveLength(1);
    expect(ast.blocks[0].children[0].raw).toBe(raw);
    ast.version = "0.3.0";
    expect(() => compileGraph(ast)).toThrow("Unsupported AST format 0.3.0");
  });

  it("rejects prior unpublished join AST and Explain variants despite their matching format label", () => {
    const { graph, explain } = compileGraphWithExplain(parseDocument("- [C] Target.\n  - [linked]\n    - [G] Premise."));
    expect(validateGraph(json(graph))).toBe(true);
    const oldAst = json(parseDocument("- [linked]"));
    oldAst.blocks[0].annotation.kind = "join";
    expect(validateAst(oldAst)).toBe(false);
    oldAst.blocks[0].annotation.kind = "linked";
    oldAst.blocks[0].annotation.syntaxErrors = ["join"];
    expect(validateAst(oldAst)).toBe(false);
    for (const mutation of ["recognition", "membership", "emission", "skip"] as const) {
      const oldExplain = json(explain);
      if (mutation === "recognition") oldExplain.entries[1].recognition.kind = "join";
      if (mutation === "membership") oldExplain.entries[2].effects[0] = { kind: "joinMember", joinSpan: oldExplain.entries[1].sourceSpan, eligible: true };
      if (mutation === "emission") oldExplain.entries[1].effects.find((effect: { kind: string }) => effect.kind === "emitBearing").reason = "join-containment";
      if (mutation === "skip") oldExplain.entries[2].effects.find((effect: { kind: string }) => effect.kind === "skipBearing").reason = "join-membership";
      expect(validateExplain(oldExplain), mutation).toBe(false);
    }
  });

  it("rejects mirrored AST fields even when they agree with the annotation", () => {
    const ast = parseDocument("- [C @claim] Claim.\n  - [G @reason; @route] Reason.\n");
    for (const [field, value] of Object.entries({
      id: "reason", role: "G", handle: "route", status: "open",
      syntaxErrors: ["operator"], linkedSyntaxErrors: ["linked"], operatorClause: { op: "supports", sources: "self", target: { id: "claim" } }
    })) {
      const invalid = json(ast);
      invalid.blocks[0].children[0][field] = value;
      expect(validateAst(invalid), field).toBe(false);
    }
  });

  it("distinguishes self-sourced Point operators from edge source lists", () => {
    for (const mark of ["G", "?", ". @material"]) {
      const ast = json(parseDocument(`- [C @claim] Claim.\n- [${mark} +> @claim] Reason.\n`));
      expect(validateAst(ast)).toBe(true);
      ast.blocks[1].annotation.operatorClause.sources = [{ id: "claim" }];
      expect(validateAst(ast), mark).toBe(false);
    }
    const edge = json(parseDocument("- [edge @reason +> @claim] A route.\n"));
    expect(validateAst(edge)).toBe(true);
    edge.blocks[0].annotation.operatorClause.sources = "self";
    expect(validateAst(edge)).toBe(false);
    // A malformed edge remains inspectable without a successfully parsed operator.
    expect(validateAst(json(parseDocument("- [edge] Unfinished route.\n")))).toBe(true);
  });

  it("rejects other AST format versions instead of silently reinterpreting them", () => {
    const ast = parseDocument("- [C] Claim.\n");
    ast.version = "0.2.0";
    expect(() => compileGraph(ast)).toThrow("Unsupported AST format 0.2.0");
    expect(() => compileGraphWithExplain(ast)).toThrow("Unsupported AST format 0.2.0");
  });

  it("uses a single target reference and rejects target arrays in AST JSON", () => {
    const source = "- [C @claim] Claim.\n- [G +> @claim] Reason.\n";
    const ast = json(parseDocument(source));
    expect(ast.blocks[1].annotation.operatorClause).toEqual({ op: "supports", sources: "self", target: { id: "claim" } });
    expect(validateAst(ast)).toBe(true);
    const legacy = json(ast);
    const clause = legacy.blocks[1].annotation.operatorClause;
    clause.targets = [clause.target];
    delete clause.target;
    expect(validateAst(legacy)).toBe(false);
    ast.blocks[1].annotation.operatorClause.target = [{ id: "claim" }];
    expect(validateAst(ast)).toBe(false);
  });

  it("accepts opaque graph keys without making the compiler's numbering a schema requirement", () => {
    const { graph, explain } = json(compileGraphWithExplain(parseDocument(
      "- [C @claim] Claim.\n  - [G; @route] Reason.\n- [O /> @route] Objection.\n"
    )));
    const keys = new Map<string, string>([
      ...graph.points.map((point: { key: string }, i: number) => [point.key, `point:${i}:opaque`]),
      ...graph.bearings.map((bearing: { key: string }, i: number) => [bearing.key, `route:${i}:opaque`])
    ]);
    function replaceKeys(value: any): void {
      if (!value || typeof value !== "object") return;
      if (typeof value.key === "string") value.key = keys.get(value.key);
      for (const child of Object.values(value)) replaceKeys(child);
    }
    replaceKeys(graph);
    replaceKeys(explain);
    expect(validateGraph(graph)).toBe(true);
    expect(validateExplain(explain)).toBe(true);
    graph.points[0].key = "";
    expect(validateGraph(graph)).toBe(false);
  });

  it("permits rejected target mismatches in Explain, but never in emitted summaries", () => {
    const { explain } = compileGraphWithExplain(parseDocument("- [C @claim] Claim.\n- [O /> @claim] Invalid undercut.\n"));
    const rejected = json(explain);
    expect(validateExplain(rejected)).toBe(true);
    expect(rejected.entries[1].effects).toContainEqual(expect.objectContaining({
      kind: "rejectBearing", bearing: expect.objectContaining({ kind: "undercuts", target: expect.objectContaining({ kind: "point" }) })
    }));
    const emitted = json(compileGraphWithExplain(parseDocument("- [C @claim] Claim.\n  - [G] Reason.\n")).explain);
    emitted.entries[1].effects.find((effect: { kind: string }) => effect.kind === "emitBearing").bearing.kind = "undercuts";
    expect(validateExplain(emitted)).toBe(false);
  });

  it("does not alias emitted Explain references to the canonical graph", () => {
    const { graph, explain } = compileGraphWithExplain(parseDocument("- [C] Claim.\n  - [G] Reason.\n"));
    const before = json(graph);
    const emitted = explain.entries[1].effects.find((effect) => effect.kind === "emitBearing");
    if (emitted?.kind !== "emitBearing") throw new Error("Expected a Bearing emission.");
    emitted.bearing.target.key = "edited";
    emitted.bearing.sources[0].key = "edited-source";
    expect(graph).toEqual(before);
  });

  it("validates the public source envelopes used by host integrations", () => {
    const source = [
      "Introductory prose.",
      "",
      "```cog",
      "- [C @claim] A claim.",
      "  - [G] A reason.",
      "```",
      ""
    ].join("\n");
    const parsed = parseSource(source, "host");
    const compiled = compileSource(source, "host");
    const explained = explainSource(source, "host");

    for (const result of [parsed, compiled, explained]) expect(validateSource(json(result))).toBe(true);
    expect(compiled.units).toHaveLength(compiled.documents.length);
    expect(compiled.units).toHaveLength(compiled.graphs.length);
    expect(explained.units).toHaveLength(explained.explanations.length);

    const invalid = json(compiled);
    invalid.units[0].kind = "editor-node";
    expect(validateSource(invalid)).toBe(false);
  });
});
