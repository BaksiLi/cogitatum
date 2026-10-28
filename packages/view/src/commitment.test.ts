import { describe, expect, it } from "vitest";
import { explainSource } from "../../core/src/index.js";
import { describeCommitment } from "./commitment.js";
import { projectReading } from "./reading-projection.js";

const source = [
  "- [C @c] Claim.",
  "  - [G @g; @step] Ground.",
  "    - Context from the case file.",
  "      - [O] Through body.",
  "    - [_ -> ^/; @r] Together.",
  "      - [. @x] X.",
  "      - [. @y] Y.",
  "      - [_ note] Note on the joint.",
  "    - [C] Sub-claim.",
  "  - [G -> @g] Explicit.",
  "- [C] Other.",
  "  - [_ +> ^/]",
  "    - [.] Fails."
].join("\n");
const reading = projectReading(source, explainSource(source, "document"));
const unit = reading.units[0];
const at = (line: number) => {
  const occurrence = unit.occurrences.find(item => item.line === line)!;
  return unit.commitments.find(item => item.occurrenceId === occurrence.id);
};
const lineOf = (id?: string) => unit.occurrences.find(item => item.id === id)?.line;

describe("Reading commitments", () => {
  it("records what indentation selected, the context row and crossed body, from Explain only", () => {
    expect(at(4)).toMatchObject({ basis: "indentation", kind: "challenges", target: { kind: "point" } });
    expect(lineOf(at(4)!.contextOccurrenceId)).toBe(2);
    expect(at(4)!.crossedOccurrenceIds.map(lineOf)).toEqual([3]);
    expect(at(3)).toBeUndefined();
  });

  it("brackets constructor sources under their header and keeps members relation-free", () => {
    expect(at(5)).toMatchObject({ basis: "indentation", kind: "challenges", target: { kind: "bearing" } });
    expect(at(5)!.memberOccurrenceIds.map(lineOf)).toEqual([6, 7]);
    expect(at(6)).toMatchObject({ basis: "member", memberFunction: "source" });
    expect(lineOf(at(6)!.contextOccurrenceId)).toBe(5);
    expect(at(8)).toMatchObject({ basis: "note", target: { kind: "bearing" } });
  });

  it("distinguishes named, relation-free and failed occurrences", () => {
    expect(at(10)).toMatchObject({ basis: "explicit", kind: "challenges" });
    expect(at(10)!.contextOccurrenceId).toBeUndefined();
    expect(at(9)).toMatchObject({ basis: "none", reason: "no-structural-rule" });
    expect(at(1)).toMatchObject({ basis: "none", reason: "no-eligible-ancestor" });
    expect(at(12)).toMatchObject({ basis: "failed", reason: "invalid-local-bearing" });
    expect(at(12)!.target).toBeUndefined();
    expect(lineOf(at(12)!.contextOccurrenceId)).toBe(11);
  });

  it("describes each commitment without judging the prose", () => {
    const text = (line: number) => describeCommitment(unit, at(line)!);
    expect(text(4)).toBe("From indentation: challenges @g (L2), the nearest enclosing Point. It passes through ordinary body at L3. Moving it or changing its mark can change this.");
    expect(text(5)).toBe("From indentation, with sources L6, L7: challenges @step (L2), the nearest exposed step. Moving it or changing its mark can change this.");
    expect(text(6)).toBe("Source of the constructor at L5; it adds no relation of its own.");
    expect(text(8)).toBe("From indentation: a note on @r (L5).");
    expect(text(9)).toBe("C states no relation; its position creates none.");
    expect(text(10)).toBe("Named target: challenges @g. Indentation does not choose this target.");
    expect(text(1)).toBe("No enclosing Point or step; its position creates no relation.");
    expect(text(12)).toMatch(/^No relation: the constructor or its members are invalid\. Its context is L11\. The nearest enclosing Point has no attachment, so \^\/ has no step to support\. To support the Point itself, write \[_ \+> \^\]/);
  });

  it.each([
    "- [C] Claim.\n  - [_ +> ^]\n    - [. @a] A.\n    - [. use @a]",
    "- [C] Claim.\n  - [_ +> ^]\n    - [. use @missing]"
  ])("does not present sources of a rejected joint as an established relation", source => {
    const unit = projectReading(source, explainSource(source, "document")).units[0];
    expect(unit.graph.bearings).toHaveLength(0);
    const members = unit.commitments.filter(item => item.basis === "member");
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) expect(describeCommitment(unit, member)).toBe(
      "Eligible source for the constructor at L2, which was rejected; no relation was created.");
  });

  it("names anonymous targets by line", () => {
    const anonymous = "- [C] Claim.\n  - [G] Ground.\n    - [O/] Challenge the step.";
    const projected = projectReading(anonymous, explainSource(anonymous, "document")).units[0];
    const line = (n: number) => projected.commitments.find(item => projected.occurrences.find(o => o.id === item.occurrenceId)!.line === n)!;
    expect(describeCommitment(projected, line(2))).toContain("supports the Point at L1");
    expect(describeCommitment(projected, line(3))).toContain("challenges the step at L2, the nearest exposed step");
  });
});
