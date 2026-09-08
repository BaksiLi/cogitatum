import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileGraph, compileGraphWithExplain, parseDocument } from "./index.js";

const ajv = new Ajv2020({ allErrors: true });
const schema = (name: string) => JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8"));
const validateAst = ajv.compile(schema("ast"));
const validateGraph = ajv.compile(schema("graph-ir"));
const validateExplain = ajv.compile(schema("explain"));
const json = (value: unknown) => JSON.parse(JSON.stringify(value));

describe("public compiler contract boundaries", () => {
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

  it("rejects mirrored AST fields even when they agree with the annotation", () => {
    const ast = parseDocument("- [C @claim] Claim.\n  - [G @reason; @route] Reason.\n");
    for (const [field, value] of Object.entries({
      id: "reason", role: "G", handle: "route", status: "open",
      syntaxErrors: ["operator"], operatorClause: { op: "supports", sources: "self", target: { id: "claim" } }
    })) {
      const invalid = json(ast);
      invalid.blocks[0].children[0][field] = value;
      expect(validateAst(invalid), field).toBe(false);
    }
  });

  it("distinguishes self-sourced Point operators from edge source lists", () => {
    for (const mark of ["G", "?", "@material"]) {
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
      "- [C @claim] Claim.\n  - [G; @route] Reason.\n- [O _> @route] Objection.\n"
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
    const { explain } = compileGraphWithExplain(parseDocument("- [C @claim] Claim.\n- [O _> @claim] Invalid undercut.\n"));
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
});
