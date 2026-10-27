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
  it.each(["G", "O", "R", "D"])("retains the %s linked role through every JSON projection", role => {
    const source = `- [O @target] Target.\n  - [_ ${role}; @route]\n    - [. @a] First.\n    - [. @b] Second.`;
    const result = json(explainSource(source));
    expect(validateSource(result), JSON.stringify(validateSource.errors)).toBe(true);
    const header = result.documents[0].blocks[0].children[0].annotation;
    expect(header).toMatchObject({ kind: "localBearing", role });
    expect(result.explanations[0].entries[1].recognition).toEqual({ kind: "localBearing", role });
    delete header.role;
    expect(validateAst(result.documents[0])).toBe(false);
    header.syntaxErrors = ["handle"];
    expect(validateAst(result.documents[0])).toBe(false);
    header.syntaxErrors = ["localBearing"];
    expect(validateAst(result.documents[0]), JSON.stringify(validateAst.errors)).toBe(true);
  });

  it("rejects retired Gap data while accepting its diagnosed source boundary", () => {
    const retired = json(explainSource("- [C] Outer.\n  - [?] Missing record.\n    - [G] Child."));
    expect(validateSource(retired), JSON.stringify(validateSource.errors)).toBe(true);
    const current = json(explainSource("- [Q] Is the record available?"));
    const ast = structuredClone(current.documents[0]);
    ast.blocks[0].annotation = { kind: "gap", status: "open", raw: "?" };
    expect(validateAst(ast)).toBe(false);
    const graph = structuredClone(current.graphs[0]);
    graph.points[0].declaration = { form: "gap", status: "open" };
    expect(validateGraph(graph)).toBe(false);
    const explain = structuredClone(current.explanations[0]);
    explain.entries[0].recognition = { kind: "gap", status: "open" };
    expect(validateExplain(explain)).toBe(false);
  });

  it.each(["use", "use;", "use; @route", "use @a,@b +> @c", ". use @a,@b +> @c", "G use invalid suffix"])(
    "keeps error categories unique for the malformed use [%s]",
    header => {
      const source = `- [C @outer] Outer.\n  - [${header}] Local prose.\n    - [G @inner] Independent Point.\n      - [G @detail] Its reason.\n- [C @a] Original.`;
      const result = explainSource(source);
      const annotation = result.documents[0].blocks[0].children[0].annotation!;
      expect(annotation).toMatchObject({ kind: "use", syntaxErrors: expect.arrayContaining(["reference"]) });
      expect(annotation.syntaxErrors).toEqual([...new Set(annotation.syntaxErrors)]);
      expect(validateSource(json(result)), JSON.stringify(validateSource.errors)).toBe(true);
      expect(result.graphs[0].points.map(point => point.id)).toEqual(["outer", "inner", "detail", "a"]);
      expect(result.graphs[0].bearings).toEqual([expect.objectContaining({
        sources: [{ kind: "point", key: result.graphs[0].points[2].key }],
        target: { kind: "point", key: result.graphs[0].points[1].key }
      })]);
      expect(result.explanations[0].entries[1].effects).toContainEqual(expect.objectContaining({ kind: "rejectFocus" }));
      expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain("FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET");
    }
  );

  it("permits only actual derivation kinds in emitted and rejected Bearing summaries", () => {
    for (const source of ["- [C @c] Claim.\n  - [G] Reason.", "- [G +> @missing] Failed reason."]) {
      const explain = json(compileGraphWithExplain(parseDocument(source)).explain);
      const effect = explain.entries.flatMap((entry: any) => entry.effects).find((effect: any) => effect.bearing);
      expect(effect).toBeDefined();
      for (const derivedBy of ["operator", "structural"]) {
        effect.bearing.derivedBy = derivedBy;
        expect(validateExplain(explain), JSON.stringify(validateExplain.errors)).toBe(true);
      }
      effect.bearing.derivedBy = "retired";
      expect(validateExplain(explain)).toBe(false);
    }
  });

  it("preserves repeated sources in rejected joint summaries but rejects them in emitted summaries", () => {
    const result = json(explainSource("- [C @c] Claim.\n  - [_ G]\n    - [. @g] Source.\n    - [. use @g] Same source.\n      - [G @detail] Independent support for g."));
    const rejected = result.explanations[0].entries[1].effects[0];
    expect(rejected).toMatchObject({ kind: "rejectBearing", reason: "validation-error" });
    expect(rejected.bearing.sources).toEqual([{ kind: "point", key: "_p2" }, { kind: "point", key: "_p2" }]);
    expect(result.graphs[0].bearings).toHaveLength(1);
    expect(result.graphs[0].bearings[0]).toMatchObject({ sources: [{ kind: "point", key: "_p3" }], target: { kind: "point", key: "_p2" } });
    expect(result.diagnostics.map((diagnostic: any) => diagnostic.code)).toEqual(["DUPLICATE_BEARING_SOURCES"]);
    expect(validateSource(result), JSON.stringify(validateSource.errors)).toBe(true);
    const emitted = result.explanations[0].entries.flatMap((entry: any) => entry.effects).find((effect: any) => effect.kind === "emitBearing");
    emitted.bearing.sources.push(structuredClone(emitted.bearing.sources[0]));
    expect(validateExplain(result.explanations[0])).toBe(false);
    result.graphs[0].bearings[0].sources.push(structuredClone(result.graphs[0].bearings[0].sources[0]));
    expect(validateGraph(result.graphs[0])).toBe(false);
  });

  it("validates literal notes, direct ownership and actual-selection advice across source envelopes", () => {
    const source = "- [Q @q] Inquiry.\n  - Group\n    - [C] Answer.\n      - [note] Detail.\n        - [G @q] Literal.\n          - [note @bad]\n      - [_ G]\n        - [note]\n        - [.] Reason.\n- [note @bad]\n  - [C?] Literal.";
    const ast = parseDocument(source);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(validateAst(json(ast)), JSON.stringify(validateAst.errors)).toBe(true);
    expect(validateGraph(json(graph))).toBe(true);
    expect(validateExplain(json(explain)), JSON.stringify(validateExplain.errors)).toBe(true);
    const fence = String.fromCharCode(96).repeat(3);
    expect(validateSource(json(explainSource(fence + "cog\n" + source + "\n" + fence, "host")))).toBe(true);
    const invalid = json(ast);
    invalid.blocks[0].children[0].children[0].children[0].children[0].annotation = { kind: "role", role: "G", raw: "G" };
    expect(validateAst(invalid)).toBe(false);
    for (const field of ["anchor", "handle", "ref"]) {
      const namedNote = json(ast);
      namedNote.blocks[1].annotation[field] = field === "ref" ? { id: "q" } : "q";
      expect(validateAst(namedNote), field).toBe(false);
    }
    const advice = json(explain).entries.flatMap((entry: any) => entry.effects).find((effect: any) => effect.kind === "implicitAttachment");
    for (const invalidEffect of [{ ...advice, target: { id: "q" } }, { ...advice, contextSpan: undefined }]) {
      expect(validateExplain({ ...json(explain), entries: [{ ...json(explain).entries[2], effects: [invalidEffect] }] })).toBe(false);
    }
  });

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
      "- [C @premise] Original.\n- [C @claim] Claim.\n  - [G use @premise; @step] Local prose.\n    - [O/ use @premise] Assessment.",
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
    const ast = parseDocument("- [C @claim] Claim.\n  - [_ G]\n    - [.] Premise.\n    - [G/] Warrant.\n    - [O/] Objection.\n      - [R] Reply.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(graph.diagnostics).toEqual([]);
    expect(validateAst(json(ast))).toBe(true);
    expect(validateGraph(json(graph))).toBe(true);
    expect(validateExplain(json(explain))).toBe(true);
    const invalid = json(ast);
    invalid.blocks[0].children[0].children[1].annotation.role = "C";
    expect(validateAst(invalid)).toBe(false);
    const malformed = parseDocument("- [C] Claim.\n  - [G] Ground.\n    - [O/ /> @missing] Excluded combination.");
    const result = compileGraphWithExplain(malformed);
    expect(validateAst(json(malformed))).toBe(true);
    expect(validateExplain(json(result.explain))).toBe(true);
  });

  it.each(["G", "O", "Q"])("keeps the %s/ use recognition correlated with its local role", role => {
    const source = `- [C @claim] Claim.\n  - [G @reason; @route] Reason.\n    - [${role}/ use @reason] Review this step.`;
    const { explain } = compileGraphWithExplain(parseDocument(source));
    const recognition = explain.entries[2].recognition;
    expect(recognition).toEqual({ kind: "use", ref: { id: "reason" }, role, selector: "attachment" });
    expect(explain.diagnostics).toEqual([]);
    expect(validateAst(json(parseDocument(source))), JSON.stringify(validateAst.errors)).toBe(true);
    expect(validateExplain(json(explain)), JSON.stringify(validateExplain.errors)).toBe(true);
    for (const invalidRole of [undefined, "C", "R", "D"]) {
      const invalid = json(explain);
      invalid.entries[2].recognition.role = invalidRole;
      expect(validateExplain(json(invalid)), String(invalidRole)).toBe(false);
    }
  });

  it("preserves a Q selector and its typed target through complete source serialization", () => {
    const source = "- [C @claim] Claim.\n  - [G; @step] Reason.\n    - [Q/ @question] Which conditions apply?";
    const result = json(explainSource(source));
    expect(validateSource(result), JSON.stringify(validateSource.errors)).toBe(true);
    const { graph, explain } = compileGraphWithExplain(result.documents[0]);
    expect(graph).toEqual(result.graphs[0]);
    expect(explain).toEqual(result.explanations[0]);
    for (const role of ["C", "R", "D"]) {
      const invalid = structuredClone(result);
      invalid.documents[0].blocks[0].children[0].children[0].annotation.role = role;
      expect(validateAst(invalid.documents[0]), role).toBe(false);
    }
  });

  it("validates failed Point annotations as retained source boundaries", () => {
    const ast = parseDocument("- [C @outer] Outer.\n  - [O?] Invalid.\n    - [G] Valid child.");
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(validateAst(json(ast))).toBe(true);
    expect(validateGraph(json(graph))).toBe(true);
    expect(validateExplain(json(explain))).toBe(true);
  });

  it("validates all named kinds on explicit Bearings, Point declarations and Point uses", () => {
    for (const kind of ["supports", "challenges", "concerns", "answers", "repliesTo", "clarifies"]) {
      const target = "claim";
      const source = "- [C @claim] Claim.\n- [. @material] Material.\n- [edge @material supports @claim; @route]\n- [edge @claim " + kind + " @" + target + "]\n- [Q @question " + kind + " @claim] Which scale?\n- [. use @material " + kind + " @claim]";
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
      self.blocks[1].annotation.operatorClause.targetKind = "point";
      expect(validateAst(self), kind).toBe(true);
      self.blocks[1].annotation.operatorClause.targetKind = "either";
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
    expect(graph.points[1]).toMatchObject({ id: "objection", declaration: { form: "role", role: "O" } });
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
    const ast = parseDocument("- [C] Target.\n  - [_ G]\n    - [.] First.");
    // Compiler semantics belong to annotation, not retained raw source.
    const raw = ast.blocks[0].children[0].raw;
    delete ast.blocks[0].children[0].annotation;
    const graph = compileGraph(ast);
    expect(graph.bearings).toHaveLength(0);
    expect(graph.points).toHaveLength(2);
    expect(ast.blocks[0].children[0].raw).toBe(raw);
    ast.version = "0.3.0";
    expect(() => compileGraph(ast)).toThrow("Unsupported AST format 0.3.0");
  });

  it("rejects prior unpublished join AST and Explain variants despite their matching format label", () => {
    const { graph, explain } = compileGraphWithExplain(parseDocument("- [C] Target.\n  - [_ G]\n    - [.] Premise."));
    expect(validateGraph(json(graph))).toBe(true);
    const oldAst = json(parseDocument("- [_ G]"));
    oldAst.blocks[0].annotation.kind = "join";
    expect(validateAst(oldAst)).toBe(false);
    oldAst.blocks[0].annotation.kind = "localBearing";
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
      syntaxErrors: ["operator"], localBearingSyntaxErrors: ["localBearing"], operatorClause: { op: "supports", sources: "self", target: { id: "claim" } }
    })) {
      const invalid = json(ast);
      invalid.blocks[0].children[0][field] = value;
      expect(validateAst(invalid), field).toBe(false);
    }
  });

  it("distinguishes self-sourced Point operators from edge source lists", () => {
    for (const mark of ["G", "Q", ". @material"]) {
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
    expect(ast.blocks[1].annotation.operatorClause).toEqual({ op: "supports", targetKind: "either", sources: "self", target: { id: "claim" } });
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
      kind: "rejectBearing", bearing: expect.objectContaining({ kind: "challenges", target: expect.objectContaining({ kind: "point" }) })
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

describe("Point declaration metadata", () => {
  const manifest: { fixtures: Array<{ file: string; input: "document" | "host" }> } = JSON.parse(readFileSync(new URL("../../../fixtures/manifest.json", import.meta.url), "utf8"));

  it("validates every compiled fixture graph with nested declaration metadata", () => {
    let points = 0;
    for (const { file, input } of manifest.fixtures) {
      for (const graph of compileSource(readFileSync(new URL(`../../../fixtures/${file}`, import.meta.url), "utf8"), input).graphs) {
        expect(validateGraph(json(graph)), file + JSON.stringify(validateGraph.errors)).toBe(true);
        for (const point of graph.points) expect(Object.keys(point).filter(key => ["form", "role", "status"].includes(key)), file).toEqual([]);
        points += graph.points.length;
      }
    }
    expect(points).toBeGreaterThan(100);
  });

  it("rejects flat, mixed and invalid declaration shapes", () => {
    const graph = json(compileGraph(parseDocument("- [C @claim] Open claim.\n")));
    const point = graph.points[0];
    expect(point).toEqual({ key: point.key, id: "claim", text: "Open claim.", sourceSpan: point.sourceSpan, declaration: { form: "role", role: "C" } });
    expect(validateGraph(graph)).toBe(true);
    const { declaration, ...shared } = point;
    const invalidPoints = [
      { ...point, declaration: { form: "role", role: "C", status: "open" } },
      { ...shared, ...declaration },
      { ...point, role: "C" },
      { ...point, form: "role", role: "C", status: "open" },
      { ...point, declaration: { ...declaration, sourceSpan: point.sourceSpan } },
      { ...point, declaration: { ...declaration, selector: "attachment" } },
      { ...point, declaration: { form: "role", role: "G", status: "open" } },
      { ...point, declaration: { form: "role" } },
      { ...point, declaration: { form: "gap" } },
      { ...point, declaration: { form: "gap", role: "C", status: "open" } },
      { ...point, declaration: { form: "material", role: "C" } },
      { ...point, declaration: { form: "material", status: "open" } },
      shared
    ];
    for (const invalid of invalidPoints) expect(validateGraph({ ...graph, points: [invalid] }), JSON.stringify(invalid)).toBe(false);
  });

  it("keeps shared text and declaration metadata unchanged under reuse while local marks choose typed endpoints", () => {
    const declarations = "- [C @p] Two retries timed out.\n- [C @open] Retries may be related.\n- [. @gap] A calibration record is missing.\n- [. @wet] The road is wet.";
    const uses = [
      "- [C @a] The configuration is faulty.\n  - [G use @p; @to-a] Occurrence note.\n    - [O/ @transient; @attack] Only this route.\n  - [G use @open; @from-open]\n  - [G use @gap; @from-gap]",
      "- [C @b] The service needs monitoring.\n  - [G use @p; @to-b]\n    - [O @miscount] Only one retry timed out.",
      "- [. use @wet] Reminder.\n  - [C @aside] Not an answer.",
      "- [Q use @wet] The local mark leaves the shared wording unchanged.\n  - [.] A separate observation."
    ].join("\n");
    const alone = compileGraph(parseDocument(declarations));
    const reused = compileGraph(parseDocument(declarations + "\n" + uses));
    expect(reused.diagnostics).toEqual([]);
    expect(reused.points.slice(0, 4)).toEqual(alone.points);
    const name = new Map([...reused.points.map(point => [point.key, "@" + point.id] as const), ...reused.bearings.map(bearing => [bearing.key, ";" + bearing.handle] as const)]);
    expect(reused.bearings.map(bearing => [bearing.sources.map(ref => name.get(ref.key)).join(), bearing.kind, bearing.target.kind, name.get(bearing.target.key)])).toEqual([
      ["@p", "supports", "point", "@a"],
      ["@transient", "challenges", "bearing", ";to-a"],
      ["@open", "supports", "point", "@a"],
      ["@gap", "supports", "point", "@a"],
      ["@p", "supports", "point", "@b"],
      ["@miscount", "challenges", "point", "@p"]
    ]);
    expect(reused.bearings.filter(bearing => bearing.target.kind === "bearing").map(bearing => name.get(bearing.target.key))).toEqual([";to-a"]);
  });
});
