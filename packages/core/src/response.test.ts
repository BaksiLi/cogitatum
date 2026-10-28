import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument } from "./index.js";

describe("Response / respondsTo", () => {
  it.each(["Q", "C", "G", "O", "R", "D", "."])("records R and [_ respondsTo ^] to any nearest %s Point without claiming an answer", mark => {
    const { graph } = compileGraphWithExplain(parseDocument(`- [${mark} @target] Which scale?
  - [R] Seconds.
  - [_ respondsTo ^]
    - [.] The measurement interval was short.
    - [.] The instrument samples each second.`));
    expect(graph.diagnostics).toEqual([]);
    expect(graph.bearings.map(b => b.kind)).toEqual(["respondsTo", "respondsTo"]);
    expect(graph.bearings.map(b => b.sources.length)).toEqual([1, 2]);
    expect(graph.bearings.every(b => b.target.key === graph.points[0].key)).toBe(true);
  });

  it.each(["R", ". @p", ". use @shared", "_ @shared"])("diagnoses retired repliesTo on %s without default fallback", prefix => {
    const { graph, explain } = compileGraphWithExplain(parseDocument(`- [. @shared] Shared.
- [C @target] Target.
  - [${prefix} repliesTo @target; @failed] Response.
    - [O/] Cannot select a failed relation.`));
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(d => d.code)).toContain("RETIRED_BEARING_KIND");
    expect(explain.entries[2].effects).toContainEqual({ kind: "rejectBearing", reason: "annotation-syntax-error" });
    expect(graph.diagnostics.map(d => d.code)).toContain("NO_LOCAL_BEARING_ATTACHMENT");
  });
});
