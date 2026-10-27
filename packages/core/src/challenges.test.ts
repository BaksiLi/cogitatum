import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileGraph, compileGraphWithExplain, explainSource, parseDocument } from "./index.js";

const declarations = `- [C @claim] Conclusion.
- [G @a] First reason.
- [G @b] Second reason.
- [edge @a, @b +> @claim; @route] Joint step.`;
const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const errors = (source: string) => compile(source).graph.diagnostics.filter(d => d.severity === "error").map(d => d.code);
const ajv = new Ajv2020({ allErrors: true });
const schemas = Object.fromEntries(["ast", "graph-ir", "explain", "source"].map(name => {
  const schema = JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8"));
  ajv.addSchema(schema);
  return [name, schema];
}));

describe("format 0.6 unified challenges", () => {
  it.each([
    ["->", "either", "claim", "missing", "UNKNOWN_TARGET"],
    ["/>", "bearing", "route", "claim", "CHALLENGE_REQUIRES_BEARING_TARGET"]
  ] as const)("preserves the authored target requirement of %s through AST JSON", (spelling, targetKind, valid, invalid, code) => {
    const source = declarations + `\n- [edge @b ${spelling} @${valid}; @attack]`;
    const ast = JSON.parse(JSON.stringify(parseDocument(source)));
    const annotation = ast.blocks[4].annotation;
    expect(annotation.operatorClause).toMatchObject({ op: "challenges", targetKind });
    // Raw text is source evidence, never a second semantic input.
    annotation.raw = "edge @b supports @claim";
    ast.blocks[4].raw = "- [edge @b supports @claim]";
    expect(ajv.validate(schemas.ast, ast)).toBe(true);
    const graph = compileGraph(ast);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings[1]).toMatchObject({ kind: "challenges", target: { kind: targetKind === "either" ? "point" : targetKind } });
    expect(graph.bearings[1]).not.toHaveProperty("targetKind");
    annotation.operatorClause.target.id = invalid;
    expect(compileGraph(ast).diagnostics.map(d => d.code)).toContain(code);
    expect(compileGraph(ast).bearings.map(b => b.handle)).toEqual(["route"]);
  });

  it.each(["edge", "_"])("rejects retired undercuts in %s without emitting a relation or crossing its boundary", constructor => {
    const source = declarations + `
- [C @outer] Outer.
  - [G @parent; @outer-route] Outer reason.
    - [${constructor} @a, @b undercuts @route; @failed] Retired connection.
      - [O/] Must not challenge outer-route.
      - [G @child] Must not support parent.
      - [O @independent /> @route; @kept] Independent explicit relation.
- [O /> @failed] Must not resolve a rejected handle.`;
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    const retirement = graph.diagnostics.find(d => d.code === "RETIRED_BEARING_KIND");
    expect(retirement).toMatchObject({ severity: "error", sourceSpan: { startLine: 7 } });
    expect(retirement?.message).toContain("replace undercuts with />");
    expect(graph.bearings.map(b => b.handle)).toEqual(["route", "outer-route", "kept"]);
    expect(graph.bearings[2].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
    expect(graph.points.some(p => p.id === "child")).toBe(true);
    expect(graph.diagnostics.map(d => d.code)).toEqual(["RETIRED_BEARING_KIND", "NO_LOCAL_BEARING_ATTACHMENT", "EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET", "UNKNOWN_TARGET"]);
    expect(graph.diagnostics.map(d => d.code)).toContain("EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET");
    const entry = explain.entries.find(e => e.sourceSpan.startLine === 7)!;
    expect(entry.recognition).toEqual({ kind: "explicitBearing" });
    expect(entry.effects.some(e => e.kind === "emitBearing")).toBe(false);
    for (const [schema, value] of [[schemas.ast, ast], [schemas["graph-ir"], graph], [schemas.explain, explain]]) {
      expect(ajv.validate(schema, JSON.parse(JSON.stringify(value))), JSON.stringify(ajv.errors)).toBe(true);
    }
  });

  it.each(["claim", "route", "missing"])("rejects retired undercuts before resolving target %s", target => {
    const source = declarations + `\n- [edge @a undercuts @${target}; @failed]`;
    expect(errors(source)).toEqual(["RETIRED_BEARING_KIND"]);
    expect(compile(source).graph.bearings.map(b => b.handle)).toEqual(["route"]);
    const migrated = declarations + `\n- [edge @a /> @${target}; @new]`;
    expect(errors(migrated)).toEqual(target === "route" ? [] : [target === "claim" ? "CHALLENGE_REQUIRES_BEARING_TARGET" : "UNKNOWN_TARGET"]);
  });

  it("does not reserve undercuts in prose, names, or literal notes", () => {
    const { graph } = compile(declarations + "\n- [O @undercuts /> @route] This theory calls it undercuts.\n- [note] Literal example.\n  - [edge @a undercuts @route]");
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points.at(-1)?.id).toBe("undercuts");
    expect(graph.bearings.at(-1)?.kind).toBe("challenges");
  });

  it.each(["claim", "route"])("allows named challenges against %s with ordered sources and distinct instances", target => {
    const { graph, explain } = compile(declarations + `\n- [edge @b, @a challenges @${target}; @one]\n- [_ @b, @a challenges @${target}; @two]`);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.slice(1).map(b => [b.kind, b.target.kind, b.handle])).toEqual([
      ["challenges", target === "claim" ? "point" : "bearing", "one"],
      ["challenges", target === "claim" ? "point" : "bearing", "two"]
    ]);
    expect(graph.bearings[1].sources).toEqual(graph.bearings[0].sources.toReversed());
    expect(graph.bearings[1].key).not.toBe(graph.bearings[2].key);
    expect(ajv.validate(schemas["graph-ir"], graph)).toBe(true);
    expect(ajv.validate(schemas.explain, explain)).toBe(true);
  });

  it("retains target checks on Point declarations and uses, including anonymous sources", () => {
    for (const mark of ["O", "G", "Q", ".", "O use @a", "G use @b", ". use @a"]) {
      expect(errors(declarations + `\n- [${mark} -> @route]`)).toEqual([]);
      expect(errors(declarations + `\n- [${mark} /> @claim]`)).toEqual(["CHALLENGE_REQUIRES_BEARING_TARGET"]);
      const { graph } = compile(declarations + `\n- [${mark} /> @route]`);
      expect(graph.bearings[1]).toMatchObject({ kind: "challenges", target: { kind: "bearing" } });
    }
  });

  it("keeps suffix-only local selection and never crosses a failed constructor", () => {
    const linked = "- [C @claim] Claim.\n  - [_ G; @route]\n    - [.] Reason.\n    - [O/] Challenge the step.\n      - [R] Reply.";
    const { graph } = compile(linked);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(b => [b.kind, b.target.kind])).toEqual([
      ["supports", "point"], ["challenges", "bearing"], ["repliesTo", "point"]
    ]);
    expect(errors(linked.replace("[O/]", "[O]"))).toContain("INVALID_LOCAL_BEARING_MEMBER");
    expect(errors(declarations + "\n  - [O] Bare objection.")).toContain("EXPLICIT_BEARING_DESCENDANT_REQUIRES_TARGET");
    expect(errors(declarations + "\n- [_ use @route]\n  - [O] Bare objection.")).toContain("BEARING_USE_REQUIRES_EXPLICIT_TARGET");
    const failed = compile(declarations + "\n- [edge @a /> @claim; @failed]\n  - [O/] No outward fallback.\n- [O /> @failed] Dependent.\n- [O -> @claim] Independent.").graph;
    expect(failed.bearings.map(b => b.handle)).toEqual(["route", undefined]);
    expect(failed.bearings[1].target.kind).toBe("point");
    expect(failed.diagnostics.filter(d => d.code === "UNRESOLVED_BEARING_TARGET")).toHaveLength(2);
  });

  it.each(["O", "Q", ".", "O use @a", ". use @a"])("accepts current target constraints in the %s AST schema", mark => {
    const ast = JSON.parse(JSON.stringify(parseDocument(declarations + `\n- [${mark} /> @route] Objection.`)));
    const clause = ast.blocks[4].annotation.operatorClause;
    for (const targetKind of ["point", "bearing", "either"]) {
      clause.targetKind = targetKind;
      expect(ajv.validate(schemas.ast, ast), targetKind).toBe(targetKind !== "point");
    }
  });

  it.each(["supports", "concerns", "answers", "repliesTo", "clarifies"])("keeps %s target requirements aligned with the AST schema", op => {
    const ast = JSON.parse(JSON.stringify(parseDocument(declarations + `\n- [edge @a ${op} @claim]`)));
    for (const targetKind of ["point", "bearing", "either"]) {
      ast.blocks[4].annotation.operatorClause.targetKind = targetKind;
      expect(ajv.validate(schemas.ast, ast), targetKind).toBe(targetKind === (op === "supports" || op === "concerns" ? "either" : "point"));
    }
  });

  it("requires target constraints and rejects old JSON instead of relabelling it", () => {
    const ast = JSON.parse(JSON.stringify(parseDocument(declarations + "\n- [O /> @route] Objection.")));
    const clause = ast.blocks[4].annotation.operatorClause;
    clause.targetKind = "point";
    expect(ajv.validate(schemas.ast, ast)).toBe(false);
    delete clause.targetKind;
    expect(ajv.validate(schemas.ast, ast)).toBe(false);
    ast.version = "0.4.0";
    expect(() => compileGraph(ast)).toThrow("Unsupported AST format 0.4.0");
    const graph = JSON.parse(JSON.stringify(compile(declarations + "\n- [O /> @route] Objection.").graph));
    graph.bearings[1].kind = "undercuts";
    expect(ajv.validate(schemas["graph-ir"], graph)).toBe(false);
  });

  it.each([["->", "claim"], ["/>", "route"]])("preserves %s when suggesting reuse of a duplicate declaration", (operator, target) => {
    const { graph } = compile(declarations + `\n- [O @a ${operator} @${target}] Duplicate.`);
    expect(graph.diagnostics.find(d => d.code === "DUPLICATE_ID")?.explanation).toContain(`[O use @a ${operator} @${target}]`);
  });

  it("validates the host envelope and keeps each fence's references isolated", () => {
    const fence = "```";
    const source = [fence + "cog", declarations, "- [O /> @route] Objection.", fence, fence + "cog", "- [O /> @route] No imported route.", fence].join("\n");
    const result = explainSource(source, "host");
    expect(ajv.validate(schemas.source, JSON.parse(JSON.stringify(result))), JSON.stringify(ajv.errors)).toBe(true);
    expect(result.graphs[0].bearings[1].target.kind).toBe("bearing");
    expect(result.graphs[1].bearings).toEqual([]);
    expect(result.graphs[1].diagnostics.map(d => d.code)).toEqual(["UNKNOWN_TARGET"]);
  });
});
