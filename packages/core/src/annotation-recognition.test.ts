import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { compileGraph, compileGraphWithExplain, parseDocument } from "./index.js";
import type { GraphIR } from "./types.js";

const ajv = new Ajv2020({ allErrors: true });
const astSchema = JSON.parse(readFileSync(new URL("../../../spec/ast.schema.json", import.meta.url), "utf8"));
const validateAst = ajv.compile(astSchema);
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const codes = (graph: GraphIR) => graph.diagnostics.map(diagnostic => diagnostic.code);
const ids = (graph: GraphIR) => graph.points.map(point => point.id ?? point.declaration.form);
const message = (graph: GraphIR, code: string) => graph.diagnostics.find(diagnostic => diagnostic.code === code)?.message ?? "";

function nested(prefix: string) {
  const ast = parseDocument(`- [C @outer] Outer.\n  - ${prefix} text.\n    - [G @inner] Ground.`);
  return { ast, ...compileGraphWithExplain(ast) };
}

describe("annotation recognition boundaries", () => {
  // Hyphens, plus signs and slashes inside a word do not end a mark.
  it.each(["[O-ring]", "[C-section]", "[D-Day]", "[R-squared]", "[C++]", "[G/O ratio]", "[o-ring]", "[O-ring", "[G/O ratio", "[C++"])(
    "keeps ordinary %s prose as transparent body",
    prefix => {
      const { ast, graph, explain } = nested(prefix);
      expect(ast.blocks[0].children[0].annotation).toBeUndefined();
      expect(ast.blocks[0].children[0].text.startsWith(prefix)).toBe(true);
      expect(explain.entries[1].recognition).toEqual({ kind: "body" });
      expect(ids(graph)).toEqual(["outer", "inner"]);
      expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports"]);
      expect(graph.diagnostics.map(diagnostic => diagnostic.severity)).toEqual(["suggestion"]);
    }
  );

  it.each([
    ["[g]", "MALFORMED_ANNOTATION", "Marks are uppercase: write G, not g."],
    ["[c @claim]", "MALFORMED_ANNOTATION", "write C, not c"],
    ["[C?]", "RETIRED_CLAIM_OPENNESS", "C? is retired"],
    ["[Q?]", "ROLE_OPENNESS_UNSUPPORTED", "Use ? only for a Gap"],
    ["[C/]", "UNSUPPORTED_LOCAL_BEARING_SELECTOR", "Only G/ and O/"],
    ["[?/]", "UNSUPPORTED_LOCAL_BEARING_SELECTOR", "Only G/ and O/"],
    ["[C major]", "MALFORMED_ROLE_ANNOTATION", "remove the brackets"],
    ["[O-> @outer", "MALFORMED_ANNOTATION_PREFIX", "closing ']'"]
  ])("keeps genuine intent in %s diagnosed as a failed boundary", (prefix, code, text) => {
    const { graph } = nested(prefix);
    expect(codes(graph)).toContain(code);
    expect(message(graph, code)).toContain(text);
    expect(ids(graph)).toEqual(["outer", "inner"]);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toContain("FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET");
  });

  it("keeps valid selectors, retired selectors and retired grouping keywords recognized", () => {
    expect(nested("[G/]").graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["NO_LOCAL_BEARING_ATTACHMENT"]);
    expect(codes(nested("[O_ @x]").graph)).toEqual(["RETIRED_AUTHORING_SYNTAX"]);
    expect(nested("[G/ @x").ast.blocks[0].children[0].annotation).toMatchObject({ kind: "invalid", selector: "attachment" });
    expect(codes(nested("[join]").graph)).toContain("RETIRED_JOIN_ANNOTATION");
    expect(nested("[G/O ratio]").ast.blocks[0].children[0].annotation).toBeUndefined();
  });

  it.each([
    ["[O->@outer]", "[O -> @outer]", "role"],
    ["[O/>@outer]", "[O /> @outer]", "role"],
    ["[? @gap~>@outer]", "[? @gap ~> @outer]", "gap"],
    ["[G use @outer+>@outer]", "[G use @outer +> @outer]", "use"]
  ])("rejects only the clause of the spacing error in %s", (prefix, spaced, kind) => {
    const ast = parseDocument(`- [C @outer] Outer.\n- ${prefix} Text.\n  - [G] Child.`);
    const { graph } = compileGraphWithExplain(ast);
    const annotation = ast.blocks[1].annotation;
    expect(annotation).toMatchObject({ kind, syntaxErrors: expect.arrayContaining(["operator"]) });
    expect(annotation && "operatorClause" in annotation ? annotation.operatorClause : undefined).toBeUndefined();
    expect(validateAst(json(ast)), JSON.stringify(validateAst.errors)).toBe(true);
    expect(codes(graph)[0]).toBe("MALFORMED_EXPLICIT_BEARING");
    expect(message(graph, "MALFORMED_EXPLICIT_BEARING")).toBe(`Separate an operator from its neighbours with spaces, as in ${spaced}.`);
    // The occurrence keeps its Point or focus; its child attaches to it, never past it.
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["supports"]);
    expect(graph.bearings.every(bearing => bearing.kind !== "challenges" && bearing.kind !== "undercuts")).toBe(true);
  });

  it("ends a name at a glued operator, since > cannot occur in a name", () => {
    const { graph } = compileGraphWithExplain(parseDocument("- [C @target] Target.\n- [C @source->target] Missing @ on the target."));
    expect(ids(graph)).toEqual(["target", "source"]);
    expect(codes(graph)).toEqual(["MALFORMED_EXPLICIT_BEARING", "MALFORMED_BEARING_TARGETS"]);
    expect(graph.bearings).toEqual([]);
  });

  it("keeps a spacing error in an edge as a failed edge boundary", () => {
    const { graph } = compileGraphWithExplain(parseDocument("- [C @a] A.\n- [C @b] B.\n- [C @c] C.\n- [_ @a,@b+>@c] Joint.\n  - [G] Child."));
    expect(codes(graph)).toEqual(["MALFORMED_EXPLICIT_BEARING", "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET"]);
    expect(message(graph, "MALFORMED_EXPLICIT_BEARING")).toContain("[_ @a,@b +> @c]");
    expect(graph.bearings).toEqual([]);
  });
});

describe("clean edge annotations require an operator clause", () => {
  const source = "- [. @a] A.\n- [C @c] C.\n  - [_ @a supports @c] Route.\n    - [G] Child.";

  it("rejects a clause-less clean edge in the AST schema but keeps diagnosed parser edges valid", () => {
    const ast = json(parseDocument(source));
    expect(validateAst(ast)).toBe(true);
    const clauseless = structuredClone(ast);
    delete clauseless.blocks[1].children[0].annotation.operatorClause;
    expect(validateAst(clauseless)).toBe(false);
    for (const malformed of ["- [edge] Missing clause.", "- [_ @a +>] Missing target.", "- [edge @a +> @c", "- [_ @a,@b+>@c]"]) {
      const parsed = json(parseDocument(malformed));
      expect(parsed.blocks[0].annotation, malformed).toMatchObject({ kind: "edge", syntaxErrors: expect.arrayContaining(["operator"]) });
      expect(parsed.blocks[0].annotation.operatorClause, malformed).toBeUndefined();
      expect(parsed.diagnostics.length, malformed).toBeGreaterThan(0);
      expect(validateAst(parsed), malformed).toBe(true);
    }
  });

  it("refuses a clause-less clean edge at every depth instead of deriving a relation", () => {
    const nestedAst = json(parseDocument(source));
    delete nestedAst.blocks[1].children[0].annotation.operatorClause;
    const topLevelAst = json(parseDocument("- [. @a] A.\n- [C @c] C.\n- [_ @a supports @c] Route."));
    delete topLevelAst.blocks[2].annotation.operatorClause;
    for (const [ast, at] of [[nestedAst, "3:5"], [topLevelAst, "3:3"]] as const) {
      const before = structuredClone(ast);
      const expected = `Invalid AST: the edge annotation at ${at} has no operatorClause and records no syntax error`;
      expect(() => compileGraph(ast)).toThrow(expected);
      expect(() => compileGraphWithExplain(ast)).toThrow(expected);
      expect(ast).toEqual(before);
    }
  });

  it("compiles the parser's diagnosed edge as a rejected boundary without mutating the AST", () => {
    const ast = parseDocument("- [. @a] A.\n- [C @c] C.\n  - [_ @a supports] Route.\n    - [G] Child.");
    const before = structuredClone(ast);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(ast).toEqual(before);
    expect(compileGraph(ast)).toEqual(graph);
    expect(graph.bearings).toEqual([]);
    expect(codes(graph)).toEqual(["MALFORMED_EXPLICIT_BEARING", "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET", "DISCONNECTED_ANCHORED_MATERIAL"]);
    expect(explain.entries[2].effects).toEqual([{ kind: "rejectBearing", reason: "annotation-syntax-error" }]);
  });
});

describe("actionable parser messages", () => {
  const diagnosticFor = (source: string) => parseDocument(source).diagnostics;

  it.each([
    ["- [G @x supports @c]", "MALFORMED_ROLE_ANNOTATION", "on a Point write the operator: [G @x +> @c]."],
    ["- [R repliesTo @o]", "MALFORMED_ROLE_ANNOTATION", "repliesTo has no Point-attached form. Declare [R @name] and connect it with [_ @name repliesTo @o]"],
    ["- [O use @p repliesTo @o]", "MALFORMED_POINT_USE", "Connect the existing Point with [_ @p repliesTo @o]"],
    ["- [G @a, @b +> @c]", "MALFORMED_ROLE_BEARING", "write joint sources in an edge: [_ @a, @b +> @c]."],
    ["- [. @a, @b ~> @c]", "MALFORMED_EXPLICIT_BEARING", "[_ @a, @b ~> @c]"],
    ["- [_ @a repliesto @b]", "MALFORMED_EDGE_ANNOTATION", "Kind names are case-sensitive: write repliesTo, not repliesto."],
    ["- [_ @a refutes @b]", "MALFORMED_EDGE_ANNOTATION", "refutes is not a canonical kind"],
    ["- [g/]", "MALFORMED_LOCAL_BEARING_SELECTOR", "write G/, not g/"],
    ["- [g +> @c]", "MALFORMED_EXPLICIT_BEARING", "write G, not g"],
    ["- [edge cases]", "MALFORMED_EDGE_ANNOTATION", "remove the brackets"],
    ["- [linked list]", "MALFORMED_LINKED_ANNOTATION", "remove the brackets"],
    ["- [note to self]", "MALFORMED_NOTE", "remove the brackets"]
  ])("explains %s without changing its code", (source, code, text) => {
    const diagnostics = diagnosticFor(source);
    expect(diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
    expect(diagnostics.find(diagnostic => diagnostic.code === code)?.message).toContain(text);
  });

  it("keeps a duplicate anchor an error and suggests reuse that matches the colliding declaration", () => {
    for (const [line, reuse] of [["[G @x] Again.", "[G use @x]"], ["[? @x ~> @c] Again.", "[. use @x ~> @c]"], ["[. @x; @r] Again.", "[. use @x; @r]"]]) {
      const graph = compileGraph(parseDocument(`- [C @c] C.\n- [C @x] First.\n  - [G] Reason.\n- ${line}`));
      const duplicate = graph.diagnostics.find(diagnostic => diagnostic.code === "DUPLICATE_ID");
      expect(duplicate, line).toMatchObject({ severity: "error", message: "Duplicate anchor @x.", sourceSpan: { startLine: 4 } });
      expect(duplicate?.explanation, line).toContain(`No Point declared as @x is emitted, and Bearings that depend on @x are rejected. If this line means the existing Point, reuse it with ${reuse}`);
      expect(ids(graph), line).toEqual(["c", "role"]);
      expect(graph.bearings, line).toEqual([]);
    }
  });

  it.each([["O", "undercuts"], ["G", "supports"]])("keeps the %s/ selector in the suggested reuse and its typed endpoint", (role, kind) => {
    const prefix = "- [C @p] Shared.\n- [C @c] Claim.\n  - [G @g; @step] Ground.\n";
    const duplicate = compileGraph(parseDocument(prefix + `    - [${role}/ @p] Assess the step.`));
    const reuse = `[${role}/ use @p]`;
    expect(duplicate.diagnostics.find(diagnostic => diagnostic.code === "DUPLICATE_ID")?.explanation).toContain(`reuse it with ${reuse};`);
    const followed = compileGraph(parseDocument(prefix + `    - ${reuse} Assess the step.`));
    expect(followed.diagnostics).toEqual([]);
    const step = followed.bearings.find(bearing => bearing.handle === "step")!;
    const p = followed.points.find(point => point.id === "p")!;
    expect(followed.bearings.filter(bearing => bearing !== step)).toEqual([expect.objectContaining({ kind, sources: [{ key: p.key, kind: "point" }], target: { key: step.key, kind: "bearing" } })]);
  });
});
