import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument } from "./index.js";

describe("explicit Claim openness retirement", () => {
  it.each(["[C? @old]", "[C? use @target]", "[C? @old", "[C? use @target", "[c? @old]"])("retains %s as a failed boundary with migration advice", header => {
    const { graph, explain } = compileGraphWithExplain(parseDocument("- [C @target] Outer.\n  - " + header + "\n    - [G @child] No outward fallback.\n    - [_ @child +> @target] Independent.\n- [. use @old] No declaration."));
    expect(graph.points.map(point => point.id)).toEqual(["target", "child"]);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.bearings[0].derivedBy).toBe("operator");
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining(["RETIRED_CLAIM_OPENNESS", "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET", "UNKNOWN_POINT_REFERENCE"]));
    expect(explain.entries[1].recognition.kind).toBe("invalid");
    expect(graph.diagnostics.filter(diagnostic => diagnostic.code === "RETIRED_CLAIM_OPENNESS")).toHaveLength(1);
  });

  it("does not lose a retirement boundary on invalid indentation", () => {
    const result = compileGraphWithExplain(parseDocument("- [C @outer] Outer.\n    - Body\n  - [C?] Invalid dedent.\n    - [G] No outward attachment."));
    expect(result.graph.bearings).toEqual([]);
    expect(result.graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining(["UNMATCHED_DEDENT", "RETIRED_CLAIM_OPENNESS", "FAILED_CONTEXT_REQUIRES_EXPLICIT_TARGET"]));
  });

  it("leaves Q and Gap distinct while C carries no openness metadata", () => {
    const { graph } = compileGraphWithExplain(parseDocument("- [Q @q] What happened?\n  - [C @candidate] The pool may be exhausted.\n    - [? @record] Calibration record missing.\n- [G use @record +> @candidate] Existing gap as a reason."));
    expect(graph.diagnostics).toEqual([]);
    expect(graph.points.map(point => point.declaration)).toEqual([{ form: "role", role: "Q" }, { form: "role", role: "C" }, { form: "gap", status: "open" }]);
    expect(graph.bearings.map(bearing => bearing.kind)).toEqual(["answers", "about", "supports"]);
  });
});
