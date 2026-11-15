import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument } from "./index.js";

const compile = (source: string) => compileGraphWithExplain(parseDocument(source));

describe("Bearing dependency validation", () => {
  it("rejects a long forward chain while retaining independent relations and valid cycles", () => {
    const length = 1500;
    const source = [
      "- [C @p] Premise.",
      ...Array.from({ length }, (_, index) => `- [_ @p supports @${index === length - 1 ? "missing" : "step" + (index + 1)}; @step${index}]`),
      "- [_ @p supports @p; @independent]",
      "- [_ @p challenges @right; @left]",
      "- [_ @p concerns @left; @right]",
      "- [_ @p supports @self; @self]"
    ].join("\n");
    const { graph, explain } = compile(source);
    expect(graph.bearings.map(bearing => bearing.handle)).toEqual(["independent", "left", "right", "self"]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["UNKNOWN_TARGET"]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.sourceSpan?.startLine)).toEqual([length + 1]);
    const root = graph.diagnostics[0];
    expect(root.related).toHaveLength(length - 1);
    expect(root.related?.[0].sourceSpan.startLine).toBe(2);
    expect(root.related?.at(-1)?.sourceSpan.startLine).toBe(length);
    expect(root.related?.every(entry => entry.message === "Targets this rejected Bearing; compiles once it is fixed.")).toBe(true);
    expect(root.explanation).toBe(`${length - 1} occurrences target the Bearing rejected here and cannot compile until it resolves; they are not reported separately.`);
    expect(explain.entries.slice(1, length + 1).every(entry => entry.effects.some(effect => effect.kind === "rejectBearing"))).toBe(true);
    expect(explain.diagnostics).toEqual(graph.diagnostics);
  });

  it("keeps failure-depth and source order when independent rejection paths meet", () => {
    const { graph } = compile([
      "- [C @p] Premise.",
      "- [_ @p supports @seed-a; @first]",
      "- [_ @p supports @seed-b; @second]",
      "- [_ @p supports @first; @outer-first]",
      "- [_ @p supports @second; @outer-second]",
      "- [_ @p supports @first; @another-first]",
      "- [_ @p supports @missing-b; @seed-b]",
      "- [_ @p supports @missing-a; @seed-a]"
    ].join("\n"));
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.sourceSpan?.startLine])).toEqual([
      ["UNKNOWN_TARGET", 7], ["UNKNOWN_TARGET", 8]
    ]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.related?.map(entry => entry.sourceSpan.startLine))).toEqual([
      [3, 5], [2, 4, 6]
    ]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.explanation)).toEqual([
      "2 occurrences target the Bearing rejected here and cannot compile until it resolves; they are not reported separately.",
      "3 occurrences target the Bearing rejected here and cannot compile until it resolves; they are not reported separately."
    ]);
    for (const diagnostic of graph.diagnostics) {
      expect(diagnostic.related?.every(entry => entry.message === "Targets this rejected Bearing; compiles once it is fixed.")).toBe(true);
    }
  });

  it("invalidates a cycle with a failed source once and rejects its incoming dependents", () => {
    const { graph, explain } = compile([
      "- [C @p] Premise.",
      "- [_ @p supports @broken; @dependent]",
      "- [_ @missing supports @other; @broken]",
      "- [_ @p concerns @broken; @other]",
      "- [_ @p challenges @other; @incoming]"
    ].join("\n"));
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.sourceSpan?.startLine])).toEqual([
      ["UNKNOWN_SOURCE", 3]
    ]);
    const root = graph.diagnostics[0];
    expect(root.related?.map(entry => entry.sourceSpan.startLine)).toEqual([2, 4, 5]);
    expect(root.related?.every(entry => entry.message === "Targets this rejected Bearing; compiles once it is fixed.")).toBe(true);
    expect(root.explanation).toBe("3 occurrences target the Bearing rejected here and cannot compile until it resolves; they are not reported separately.");
    expect(explain.entries.slice(1).every(entry => entry.effects.some(effect => effect.kind === "rejectBearing"))).toBe(true);
  });
});
