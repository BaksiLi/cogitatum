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
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual([
      "UNKNOWN_TARGET", ...Array(length - 1).fill("UNRESOLVED_BEARING_TARGET")
    ]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.sourceSpan?.startLine)).toEqual(
      Array.from({ length }, (_, index) => length + 1 - index)
    );
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
      ["UNKNOWN_TARGET", 7], ["UNKNOWN_TARGET", 8],
      ["UNRESOLVED_BEARING_TARGET", 2], ["UNRESOLVED_BEARING_TARGET", 3],
      ["UNRESOLVED_BEARING_TARGET", 4], ["UNRESOLVED_BEARING_TARGET", 5], ["UNRESOLVED_BEARING_TARGET", 6]
    ]);
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
      ["UNKNOWN_SOURCE", 3],
      ["UNRESOLVED_BEARING_TARGET", 2], ["UNRESOLVED_BEARING_TARGET", 4],
      ["UNRESOLVED_BEARING_TARGET", 5]
    ]);
    expect(explain.entries.slice(1).every(entry => entry.effects.some(effect => effect.kind === "rejectBearing"))).toBe(true);
  });
});
