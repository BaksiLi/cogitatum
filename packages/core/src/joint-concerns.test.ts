import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { analyzeSourceReferences, explainSource, formatGraph } from "./index.js";

const ajv = new Ajv2020({ allErrors: true });
const schema = (name: string) => JSON.parse(readFileSync(new URL(`../../../spec/${name}.schema.json`, import.meta.url), "utf8"));
for (const name of ["ast", "graph-ir", "explain"]) ajv.addSchema(schema(name));
const validateSource = ajv.compile(schema("source"));
const declarations = [
  "- [. @before] Original clause.",
  "- [. @after] Revised clause.",
  "- [Q @change] Has the scope changed?"
].join("\n");

describe("joint concerns", () => {
  it.each([
    ["document", "~>"], ["document", "concerns"], ["host", "~>"], ["host", "concerns"]
  ] as const)("preserves ordered sources, typed targets and provenance through %s JSON using %s", (mode, operator) => {
    const content = [
      `- [_ @after, @before ${operator} @change; @comparison] Read the versions together.`,
      `- [_ @before, @after ${operator} @comparison; @context] Material concerning that comparison.`,
      declarations
    ].join("\n");
    const source = mode === "host" ? "Host prose.\n  ```cog\n" + content.split("\n").map(line => "  " + line).join("\n") + "\n  ```" : content;
    const result = explainSource(source, mode);
    expect(result.diagnostics).toEqual([]);
    expect(validateSource(JSON.parse(JSON.stringify(result))), JSON.stringify(validateSource.errors)).toBe(true);
    const graph = result.graphs[0], blocks = result.documents[0].blocks;
    expect(graph.points.map(point => [point.id, point.declaration, point.text])).toEqual([
      ["before", { form: "material" }, "Original clause."],
      ["after", { form: "material" }, "Revised clause."],
      ["change", { form: "role", role: "Q" }, "Has the scope changed?"]
    ]);
    const [before, after, change] = graph.points.map(point => ({ kind: "point" as const, key: point.key }));
    expect(graph.bearings).toEqual([
      { key: expect.any(String), handle: "comparison", kind: "concerns", sources: [after, before], target: change,
        derivedBy: "operator", sourceSpan: blocks[0].sourceSpan, text: "Read the versions together." },
      { key: expect.any(String), handle: "context", kind: "concerns", sources: [before, after],
        target: { kind: "bearing", key: graph.bearings[0].key }, derivedBy: "operator",
        sourceSpan: blocks[1].sourceSpan, text: "Material concerning that comparison." }
    ]);
    for (const [index, bearing] of graph.bearings.entries()) {
      expect(blocks[index].annotation).toMatchObject({
        kind: "bearing", operatorClause: {
          op: "concerns",
          sources: (index === 0 ? ["after", "before"] : ["before", "after"]).map(id => ({ id })),
          target: { id: index === 0 ? "change" : "comparison" }
        }
      });
      expect(result.explanations[0].entries[index]).toMatchObject({
        sourceSpan: bearing.sourceSpan,
        effects: expect.arrayContaining([{
          kind: "emitBearing", reason: "operator-clause",
          ref: { kind: "bearing", key: bearing.key, handle: bearing.handle, graphIndex: index },
          bearing: { key: bearing.key, handle: bearing.handle, kind: "concerns",
            sources: bearing.sources, target: bearing.target, derivedBy: "operator" }
        }])
      });
    }
    expect(graph.notes).toEqual(graph.bearings.map(bearing => ({
      origin: "constructor-description", target: { kind: "bearing", key: bearing.key }, sourceSpan: bearing.sourceSpan
    })));
    const inventory = analyzeSourceReferences(source, mode).references;
    expect(inventory.status).toBe("complete");
    if (inventory.status !== "complete") throw new Error("Expected complete source references.");
    expect(inventory.units[0].find(name => name.name === "before")?.references).toEqual([
      { kind: "source", sourceIndex: 1, sourceSpan: blocks[0].sourceSpan },
      { kind: "source", sourceIndex: 0, sourceSpan: blocks[1].sourceSpan }
    ]);
    expect(inventory.units[0].find(name => name.name === "comparison")?.references).toEqual([
      { kind: "target", sourceSpan: blocks[1].sourceSpan }
    ]);
    expect(formatGraph(graph)).toContain('b1: concerns([p2, p1], p3) handle="comparison"');
    expect(formatGraph(graph)).toContain('b2: concerns([p1, p2], b1) handle="context"');
  });

  it("distinguishes one common comparison from two independent relevance relations", () => {
    const joint = explainSource(declarations + "\n- [_ @before, @after ~> @change]").graphs[0];
    const independent = explainSource(declarations + "\n- [_ @before ~> @change]\n- [_ @after ~> @change]").graphs[0];
    expect(joint.diagnostics).toEqual([]);
    expect(independent.diagnostics).toEqual([]);
    expect(independent.points).toEqual(joint.points);
    expect(joint.bearings).toHaveLength(1);
    expect(independent.bearings).toHaveLength(2);
    expect(independent.bearings.map(bearing => [bearing.kind, bearing.sources, bearing.target])).toEqual(
      joint.bearings[0].sources.map(source => ["concerns", [source], joint.bearings[0].target])
    );
  });

  it.each([
    ["@after, @missing ~> @change", "UNKNOWN_SOURCE"],
    ["@after, @after ~> @change", "DUPLICATE_BEARING_SOURCES"],
    ["@after, @existing ~> @change", "BEARING_IS_NOT_BEARING_SOURCE"],
    ["@before, @after ~> @missing", "UNKNOWN_TARGET"]
  ])("rejects all of [%s] and its dependent without reducing the source set", (clause, code) => {
    const result = explainSource(declarations + [
      "", "- [_ @before, @after ~> @change; @existing]",
      `- [_ ${clause}; @failed] Rejected comparison.`,
      "- [_ @before, @after concerns @failed; @dependent]"
    ].join("\n"));
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      code, code === "DUPLICATE_BEARING_SOURCES" ? "UNKNOWN_TARGET" : "UNRESOLVED_BEARING_TARGET"
    ]);
    expect(result.graphs[0].bearings.map(bearing => bearing.handle)).toEqual(["existing"]);
    expect(result.graphs[0].notes).toEqual([]);
    for (const entry of result.explanations[0].entries.slice(4)) {
      expect(entry.effects.some(effect => effect.kind === "rejectBearing")).toBe(true);
      expect(entry.effects.some(effect => effect.kind === "emitBearing")).toBe(false);
    }
    if (code === "UNKNOWN_SOURCE") {
      const rejected = result.explanations[0].entries[4].effects.find(effect => effect.kind === "rejectBearing")!;
      expect(rejected).toMatchObject({ bearing: { kind: "concerns", sources: [
        { kind: "point", key: result.graphs[0].points[1].key }, { id: "missing" }
      ] } });
    }
    expect(validateSource(JSON.parse(JSON.stringify(result))), JSON.stringify(validateSource.errors)).toBe(true);
  });
});
