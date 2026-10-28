import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument } from "./index.js";
import type { GraphIR } from "./types.js";

const candidates = [
  {
    name: "explicit joint support",
    source: [
      "- [C @claim] The account needs a temporal model.",
      "- [G @first] The process changes over time.",
      "- [G @second] Its stages constrain one another.",
      "- [. @term] A temporal model.",
      "  - [D @clarification; @clarifies] A model of the ordered stages.",
      "- [edge @first, @second +> @claim; @route] Joint support."
    ].join("\n"),
    unmatchedLine: 2,
    clarificationLine: 5,
    survivingIds: ["clarification"]
  },
  {
    name: "linked joint support",
    source: [
      "- [C @claim] The account needs a temporal model.",
      "  - [_ +> ^; @route] Joint support.",
      "    - [. @first] The process changes over time.",
      "    - [. @second] Its stages constrain one another.",
      "- [. @term] A temporal model.",
      "  - [D @clarification; @clarifies] A model of the ordered stages."
    ].join("\n"),
    unmatchedLine: 5,
    clarificationLine: 6,
    survivingIds: ["first", "second", "clarification"]
  }
];

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));
const addMargin = (source: string) => source.split("\n").map(line => "  " + line).join("\n");
const pointRef = (graph: GraphIR, id: string) => {
  const point = graph.points.find(point => point.id === id);
  if (!point) throw new Error(`Expected Point @${id}.`);
  return { kind: "point" as const, key: point.key };
};

describe("layout diagnostic guidance without semantic recovery", () => {
  it.each(candidates)("puts layout first for $name with a common two-space margin", candidate => {
    const valid = compile(candidate.source);
    expect(valid.graph.diagnostics).toEqual([]);
    expect(valid.graph.points).toHaveLength(5);
    expect(valid.graph.bearings).toHaveLength(2);
    expect(valid.graph.bearings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        handle: "route", kind: "supports",
        sources: [pointRef(valid.graph, "first"), pointRef(valid.graph, "second")],
        target: pointRef(valid.graph, "claim")
      }),
      expect.objectContaining({
        handle: "clarifies", kind: "clarifies",
        sources: [pointRef(valid.graph, "clarification")], target: pointRef(valid.graph, "term")
      })
    ]));

    const indented = addMargin(candidate.source);
    const ast = parseDocument(indented);
    const { graph, explain } = compileGraphWithExplain(ast);
    expect(ast.blocks[0]).toMatchObject({
      raw: indented.split("\n")[0], annotation: { kind: "invalid", raw: "C @claim" }
    });
    expect(graph.diagnostics[0]).toEqual({
      code: "INDENTED_ROOT_UNSUPPORTED", severity: "error",
      message: expect.stringContaining("common left margin"),
      sourceSpan: { startLine: 1, startColumn: 1, endLine: 1, endColumn: indented.split("\n")[0].length + 1 }
    });
    expect(graph.diagnostics[0].message).toContain("preserving relative indentation");
    expect(graph.diagnostics[0].message).toContain("parent bullet");
    // These are same-indent siblings of an invalid root, not actual dedents.
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: "UNMATCHED_DEDENT", severity: "error",
      message: expect.stringContaining("valid active outline level"),
      sourceSpan: expect.objectContaining({ startLine: candidate.unmatchedLine, startColumn: 1 })
    }));
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET", severity: "error",
      message: expect.stringContaining("Fix any layout or annotation errors in the enclosing constructor first"),
      sourceSpan: expect.objectContaining({ startLine: candidate.clarificationLine, startColumn: 7 })
    }));
    const failedContext = graph.diagnostics.find(diagnostic => diagnostic.code === "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET")!;
    expect(failedContext.message).toContain("named target only if this Point is intended to attach independently");
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: "BEARING_HANDLE_WITHOUT_BEARING", severity: "error",
      message: expect.stringContaining("Resolve any layout or constructor errors first"),
      sourceSpan: expect.objectContaining({ startLine: candidate.clarificationLine, startColumn: 7 })
    }));
    expect(graph.points.map(point => point.id)).toEqual(candidate.survivingIds);
    expect(graph.bearings).toEqual([]);
    expect(explain.entries.find(entry => entry.sourceSpan.startLine === candidate.clarificationLine)?.effects)
      .toContainEqual({ kind: "rejectBearing", reason: "failed-context-requires-explicit-target" });
    expect(explain.diagnostics).toEqual(graph.diagnostics);

    // Both suggested layout repairs require the caller to change the source.
    expect(compile(indented.split("\n").map(line => line.slice(2)).join("\n"))).toEqual(valid);
    const restoredParent = compile("- Restored parent bullet.\n" + indented).graph;
    expect(restoredParent.diagnostics).toEqual([]);
    expect(restoredParent.points).toHaveLength(5);
    expect(restoredParent.bearings).toHaveLength(2);
  });

  it("retains independent errors and valid relations alongside a common-margin failure", () => {
    const fragment = addMargin(candidates[0].source);
    const independent = [
      "- [C @outer] Independent outer Point.",
      "  - [O?] Independent malformed constructor.",
      "    - Narrative beneath the failed constructor.",
      "      - [G @blocked] Must not attach to outer.",
      "        - [O @local] Can still challenge blocked.",
      "      - [G @explicit +> @outer; @independent] Deliberate independent attachment.",
      "- [edge @explicit +> @missing] Independent unresolved target."
    ].join("\n");
    const before = compile(independent);
    const { graph, explain } = compile(fragment + "\n" + independent);
    const lineOffset = fragment.split("\n").length;
    for (const diagnostic of before.graph.diagnostics) {
      expect(graph.diagnostics).toContainEqual({
        ...diagnostic,
        sourceSpan: {
          ...diagnostic.sourceSpan!,
          startLine: diagnostic.sourceSpan!.startLine + lineOffset,
          endLine: diagnostic.sourceSpan!.endLine + lineOffset
        }
      });
    }
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
      "INDENTED_ROOT_UNSUPPORTED", "ROLE_OPENNESS_UNSUPPORTED", "UNKNOWN_TARGET"
    ]));
    expect(graph.points.map(point => point.id)).toEqual(["clarification", "outer", "blocked", "local", "explicit"]);
    expect(graph.bearings).toEqual([
      expect.objectContaining({ kind: "challenges", sources: [pointRef(graph, "local")], target: pointRef(graph, "blocked") }),
      expect.objectContaining({ handle: "independent", kind: "supports", sources: [pointRef(graph, "explicit")], target: pointRef(graph, "outer") })
    ]);
    expect(explain.entries.find(entry => entry.sourceSpan.startLine === lineOffset + 4)?.effects)
      .toContainEqual({ kind: "rejectBearing", reason: "failed-context-requires-explicit-target" });
    expect(explain.diagnostics).toEqual(graph.diagnostics);
  });

  it("keeps unmatched-level and handle diagnostics meaningful without an indented root", () => {
    const { graph } = compile([
      "- [C @root] Valid root.",
      "    - [G @deep] Establish four spaces.",
      "  - [G @misaligned] Two spaces were never established.",
      "- [G @unattached; @unused] No enclosing target."
    ].join("\n"));
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      "UNMATCHED_DEDENT", "BEARING_HANDLE_WITHOUT_BEARING"
    ]);
    expect(graph.points.map(point => point.id)).toEqual(["root", "deep", "unattached"]);
    expect(graph.bearings).toEqual([
      expect.objectContaining({ sources: [pointRef(graph, "deep")], target: pointRef(graph, "root") })
    ]);
  });
});
