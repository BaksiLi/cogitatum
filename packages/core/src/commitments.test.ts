import { describe, expect, it } from "vitest";
import { compareCommitments, entailment, graphCommitments, suggestCorrespondence } from "./commitments.js";
import type { CommitmentComparison, Correspondence } from "./commitments.js";
import { compileSource } from "./index.js";
import type { GraphIR } from "./types.js";

function graph(source: string): GraphIR {
  const compiled = compileSource(source, "document");
  expect(compiled.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  return compiled.graphs[0];
}

/** Compare through the suggested correspondence, which must be unambiguous here. */
function compare(before: string, after: string) {
  const [earlier, later] = [graph(before), graph(after)];
  const suggestion = suggestCorrespondence(earlier, later);
  expect(suggestion.ambiguous).toEqual([]);
  return compared(compareCommitments(earlier, later, suggestion.correspondence));
}

function compared(result: CommitmentComparison) {
  if (result.status !== "compared") throw new Error(result.message);
  return result;
}

const claim = "- [C] The pump explains the cluster.\n";
const undecided = claim + "  - [_]\n    - [.] Most cases are near the pump.\n    - [.] Distant cases drank its water.\n";
const linked = claim + "  - [_ +> ^]\n    - [.] Most cases are near the pump.\n    - [.] Distant cases drank its water.\n";
const convergent = claim + "  - [G] Most cases are near the pump.\n  - [G] Distant cases drank its water.\n";

describe("the commitment order", () => {
  it.each([
    ["undecided grouping to a linked support", undecided, linked, "refinement"],
    ["undecided grouping to convergent supports", undecided, convergent, "refinement"],
    ["convergent supports to one linked support", convergent, linked, "revision"],
    ["a linked support to convergent supports", linked, convergent, "revision"],
    ["a linked support back to an undecided grouping", linked, undecided, "weakening"]
  ])("classifies %s", (_name, before, after, relation) => {
    expect(compare(before, after).relation).toBe(relation);
  });

  it("treats spelling, mark defaults and source order as presentation", () => {
    const marked = claim + "  - [G] Most cases are near the pump.\n";
    const named = "- [C @claim] The pump explains the cluster.\n  - [G +> @claim] Most cases are near the pump.\n";
    expect(compare(marked, named).relation).toBe("equivalent");
    const reordered = claim + "  - [_ +> ^]\n    - [.] Distant cases drank its water.\n    - [.] Most cases are near the pump.\n";
    expect(compare(linked, reordered).relation).toBe("equivalent");
  });

  it.each(["G", "O", "R", "D"])("lets %s entail relevance for the same sources and target, and not conversely", mark => {
    const strong = claim + `  - [${mark}] A remark.\n`;
    const weak = claim + "  - [_]\n    - [.] A remark.\n";
    expect(compare(strong, weak).relation).toBe("weakening");
    expect(compare(weak, strong).relation).toBe("refinement");
  });

  it("reads a nested Question as the relevance it states", () => {
    expect(compare(claim + "  - [Q] A remark?\n", claim + "  - [_]\n    - [.] A remark?\n").relation).toBe("equivalent");
  });

  it("distributes relevance alone over a joint relation's sources", () => {
    const [joint] = graphCommitments(graph(linked));
    const [a, b] = joint.sources;
    expect(entailment([joint], { ...joint, kind: "concerns" })).toEqual([joint]);
    expect(entailment([joint], { kind: "concerns", sources: [a], target: joint.target })).toEqual([joint]);
    expect(entailment([joint], { kind: "supports", sources: [b], target: joint.target })).toBeUndefined();
    const separate = graphCommitments(graph(convergent));
    expect(entailment(separate, { kind: "supports", sources: [...separate.flatMap(c => c.sources)].sort(), target: separate[0].target })).toBeUndefined();
  });

  it("treats grouping as no commitment of relevance", () => {
    const together = claim + "  - [_]\n    - [.] Most cases are near the pump.\n    - [.] Distant cases drank its water.\n";
    const apart = claim + "  - [. ~> ^] Most cases are near the pump.\n  - [. ~> ^] Distant cases drank its water.\n";
    expect(compare(together, apart)).toMatchObject({ relation: "equivalent", bearings: { removed: ["_b1"] } });
  });

  it("refines an undecided grouping into a linked support with a further premise", () => {
    const sketch = "- [C] Socrates is mortal.\n  - [_]\n    - [.] Socrates is a man.\n";
    const explicit = "- [C] Socrates is mortal.\n  - [_ +> ^]\n    - [.] Socrates is a man.\n    - [.] All men are mortal.\n";
    expect(compare(sketch, explicit).relation).toBe("refinement");
    // A stated unary support is a different commitment from the completed one.
    const unary = "- [C] Socrates is mortal.\n  - [G] Socrates is a man.\n";
    expect(compare(unary, explicit).relation).toBe("revision");
  });

  it("weakens a joint relevance by dropping a member", () => {
    const fewer = claim + "  - [_]\n    - [.] Most cases are near the pump.\n- [.] Distant cases drank its water.\n";
    expect(compare(undecided, fewer).relation).toBe("weakening");
  });

  it("keeps a grouping that something addresses as an entity", () => {
    const addressed = claim + "  - [_]\n    - [.] Most cases are near the pump.\n    - [.] Distant cases drank its water.\n    - [O/] They are not comparable.\n";
    const apart = claim + "  - [. ~> ^] Most cases are near the pump.\n  - [. ~> ^] Distant cases drank its water.\n- [.] They are not comparable.\n";
    expect(compare(addressed, apart).retracted.map(c => c.kind)).toEqual(["challenges"]);
  });

  it("keeps an uncommitted Point out of joint relevance", () => {
    const one = claim + "  - [G] Most cases are near the pump.\n- [.] Distant cases drank its water.\n";
    // Grouping the supported reason with another retracts its own support.
    expect(compare(one, undecided).relation).toBe("revision");
    const result = compare(undecided, one);
    expect(result.relation).toBe("revision");
    expect(result.retracted.map(c => c.kind)).toEqual(["concerns"]);
  });

  it("does not carry bearing on a step over to its conclusion", () => {
    const onStep = claim + "  - [G] Most cases are near the pump.\n    - [O/] The pump was closed that week.\n";
    const onClaim = claim + "  - [G] Most cases are near the pump.\n  - [O] The pump was closed that week.\n";
    const result = compare(onStep, onClaim);
    expect(result.relation).toBe("revision");
    expect(result.retracted[0].target.kind).toBe("bearing");
    expect(result.added[0].target.kind).toBe("point");
  });

  it("keeps an objection's target when only the step's kind is refined", () => {
    const before = claim + "  - [_]\n    - [.] Most cases are near the pump.\n    - [O/] Proximity is not exposure.\n";
    const after = claim + "  - [_ +> ^]\n    - [.] Most cases are near the pump.\n    - [O/] Proximity is not exposure.\n";
    const [earlier, later] = [graph(before), graph(after)];
    const suggestion = suggestCorrespondence(earlier, later);
    expect(suggestion.matches.filter(m => m.kind === "bearing").map(m => m.basis).sort()).toEqual(["endpoints", "relation"]);
    const result = compared(compareCommitments(earlier, later, suggestion.correspondence));
    expect(result.relation).toBe("refinement");
    expect(result.added.map(c => c.kind)).toEqual(["supports"]);
  });

  it("counts selecting or dropping a Point, and reports changed Points without weighing them", () => {
    const extra = claim + "- [C] The water company is liable.\n";
    expect(compare(extra, claim)).toMatchObject({ relation: "weakening", points: { removed: ["_p2"] } });
    expect(compare(claim, extra)).toMatchObject({ relation: "refinement", points: { added: ["_p2"] } });
    const [before, after] = [graph("- [Q @c] Does the pump explain it?\n"), graph("- [C @c] The pump explains it.\n")];
    const result = compared(compareCommitments(before, after, suggestCorrespondence(before, after).correspondence));
    expect(result).toMatchObject({ relation: "equivalent", points: { changed: [{ text: true, declaration: true }] } });
  });

  it("collapses Bearings stating one commitment while keeping them as distinct entities", () => {
    const twice = "- [C @c] Claim.\n- [. @a] Reason.\n- [_ @a +> @c; @one] First route.\n- [_ @a +> @c; @two] Second route.\n";
    const [commitment] = graphCommitments(graph(twice));
    expect(commitment.bearings).toHaveLength(2);
    const once = "- [C @c] Claim.\n- [. @a] Reason.\n- [_ @a +> @c; @one] First route.\n";
    expect(compare(twice, once)).toMatchObject({ relation: "equivalent", bearings: { removed: ["_b2"] } });
  });
});

describe("correspondence", () => {
  it("refuses to guess among equal texts and leaves the choice to the caller", () => {
    const twin = "- [C] Same.\n- [C] Same.\n";
    const suggestion = suggestCorrespondence(graph(twin), graph(twin));
    expect(suggestion.correspondence.points).toEqual({});
    expect(suggestion.ambiguous).toEqual([
      { kind: "point", before: "_p1", candidates: ["_p1", "_p2"], basis: "text" },
      { kind: "point", before: "_p2", candidates: ["_p1", "_p2"], basis: "text" }
    ]);
  });

  it("prefers authored names, so reordering equal texts stays equivalent", () => {
    const before = "- [C @x] Same.\n- [C @y] Same.\n- [G +> @x] Reason.\n";
    const after = "- [C @y] Same.\n- [C @x] Same.\n- [G +> @x] Reason.\n";
    const result = compare(before, after);
    expect(result.relation).toBe("equivalent");
  });

  it("lets an edit tool assert continuity the text cannot show", () => {
    const [before, after] = [graph(claim), graph("- [C] The pump probably explains the cluster.\n")];
    expect(compared(compareCommitments(before, after, suggestCorrespondence(before, after).correspondence)).relation).toBe("revision");
    const asserted: Correspondence = { points: { _p1: "_p1" }, bearings: {} };
    expect(compared(compareCommitments(before, after, asserted))).toMatchObject({ relation: "equivalent", points: { changed: [{ text: true }] } });
  });

  it("is indeterminate for partial graphs, other formats and invalid correspondences", () => {
    const partial = compileSource("- [C] Claim.\n  - [G +> @missing] Reason.\n", "document").graphs[0];
    const ok = graph(claim);
    expect(compareCommitments(ok, partial, { points: {}, bearings: {} })).toMatchObject({ status: "indeterminate", reason: "source-errors" });
    expect(compareCommitments({ ...ok, version: "0.5.0" }, ok, { points: {}, bearings: {} })).toMatchObject({ reason: "unsupported-version" });
    const two = graph("- [C] One.\n- [C] Two.\n");
    expect(compareCommitments(two, ok, { points: { _p1: "_p1", _p2: "_p1" }, bearings: {} })).toMatchObject({ reason: "invalid-correspondence" });
    expect(compareCommitments(ok, ok, { points: { _p9: "_p1" }, bearings: {} })).toMatchObject({ reason: "invalid-correspondence" });
  });

  it("reports each ambiguous entity once, at the strongest basis that found several", () => {
    const before = "- [C @c] Claim.\n- [. @a] Reason.\n- [_ @a +> @c] One.\n- [_ @a +> @c] Two.\n";
    const after = "- [C @c] Claim.\n- [. @a] Reason.\n- [_ @a +> @c] One.\n- [_ @a -> @c] Two.\n";
    const suggestion = suggestCorrespondence(graph(before), graph(after));
    expect(suggestion.ambiguous).toEqual([
      { kind: "bearing", before: "_b1", candidates: ["_b1"], basis: "relation" },
      { kind: "bearing", before: "_b2", candidates: ["_b1"], basis: "relation" }
    ]);
  });

  it("pairs unchanged Bearings on a step by their exact relation", () => {
    const source = claim + "  - [G] Reason.\n    - [O/] Objection.\n";
    const suggestion = suggestCorrespondence(graph(source), graph(source));
    expect(suggestion.matches.filter(m => m.kind === "bearing").map(m => m.basis)).toEqual(["relation", "relation"]);
  });

  it("reads only a correspondence's own entries", () => {
    const one: GraphIR = { ...graph(claim), points: [{ ...graph(claim).points[0], key: "constructor" }] };
    const none: GraphIR = { ...one, points: [] };
    expect(compareCommitments(one, none, { points: {}, bearings: {} })).toMatchObject({ relation: "weakening", points: { removed: ["constructor"] } });
  });

  it("retracts a relation whose target has no continuation, whatever the later keys are", () => {
    const base = graph("- [C] Claim.\n  - [G] Reason.\n    - [O/] Objection.\n");
    const [support, objection] = base.bearings;
    // A later graph whose replacement step happens to carry an unusual key.
    const replacement = { ...support, key: "\u0000removed:" + support.key };
    const after: GraphIR = { ...base, bearings: [replacement, { ...objection, target: { kind: "bearing", key: replacement.key } }] };
    const identity = Object.fromEntries(base.points.map(p => [p.key, p.key]));
    const result = compared(compareCommitments(base, after, { points: identity, bearings: { [objection.key]: objection.key } }));
    expect(result.relation).toBe("revision");
    expect(result.retracted.map(c => c.kind).sort()).toEqual(["challenges"]);
    expect(result.bearings).toEqual({ removed: [support.key], added: [replacement.key] });
  });
});
