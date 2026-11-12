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

function inspect(source: string, line: number) {
  const explained = explainSource(source, "document");
  const unit = projectReading(source, JSON.parse(JSON.stringify(explained))).units[0];
  const occurrence = unit.occurrences.find(item => item.line === line)!;
  const commitment = unit.commitments.find(item => item.occurrenceId === occurrence.id)!;
  return { explained, unit, occurrence, commitment, text: describeCommitment(unit, commitment) };
}

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

  it("distinguishes named, default, root and failed occurrences", () => {
    expect(at(10)).toMatchObject({ basis: "explicit", kind: "challenges" });
    expect(at(10)!.contextOccurrenceId).toBeUndefined();
    expect(at(9)).toMatchObject({ basis: "indentation", kind: "concerns", frame: { framing: "aligned", focus: "point" } });
    expect(at(1)).toMatchObject({ basis: "none", reason: "no-eligible-ancestor" });
    expect(at(12)).toMatchObject({ basis: "failed", reason: "invalid-local-bearing" });
    expect(at(12)!.target).toBeUndefined();
    expect(lineOf(at(12)!.contextOccurrenceId)).toBe(11);
  });

  it("describes each commitment without judging the prose", () => {
    const text = (line: number) => describeCommitment(unit, at(line)!);
    expect(text(4)).toBe("From indentation: challenges @g (L2), the nearest enclosing Point, passing through ordinary body at L3; moving it can change the target; the mark and Point focus select the relation.");
    expect(text(5)).toBe("From indentation, with sources L6, L7: challenges @step (L2), the nearest exposed step; moving it can change the target; the written clause states the relation.");
    expect(text(6)).toBe("Source of the constructor at L5; it adds no relation of its own.");
    expect(text(8)).toBe("From indentation: a note on @r (L5).");
    expect(text(9)).toBe("Placement records relevance: concerns @g (L2), the nearest enclosing Point; moving it can change the target; the mark and Point focus select the relation.");
    expect(text(10)).toBe("Named target: challenges @g (opposed framing); indentation does not choose this target.");
    expect(text(1)).toBe("No enclosing Point or step; its position creates no relation.");
    expect(text(12)).toMatch(/^No relation: the constructor or its members are invalid; its context is L11\. The nearest enclosing Point has no attachment, so \^\/ has no step to support\. To support the Point itself, write \[_ \+> \^\]/);
    expect(unit.occurrences.find(item => item.line === 12)!.diagnostics).toContainEqual(expect.objectContaining({ code: "NO_LOCAL_BEARING_ATTACHMENT" }));
  });

  it.each([
    ["G", "mark", "the mark and Point focus select the relation."],
    ["G +> ^", "clause", "the written clause states the relation."],
    ["G -> ^", "clause", "the written clause states the relation (opposed framing)."],
    ["G/", "mark", "the mark states the relation."],
    ["G +> ^/", "clause", "the written clause states the relation."],
    [". use @shared ~> ^", "clause", "the written clause states the relation."],
    ["_ +> ^", "clause", "the written clause states the relation."],
    ["_", "default", "the constructor defaults to concerns."],
    ["_/", "default", "the constructor defaults to concerns."]
  ])("distinguishes the target's locality from how [%s] states its relation", (header, relationBy, message) => {
    const source = `- [. @shared] Shared.\n- [C @c] Claim.\n  - [G; @step] Ground.\n    - [${header}] Detail.\n` +
      (header.startsWith("_") ? "      - [.] Source.\n" : "");
    const explained = explainSource(source);
    expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(header === "G -> ^" ? ["OPPOSED_FRAMING"] : []);
    const unit = projectReading(source, explained).units[0];
    const occurrence = unit.occurrences.find(item => item.line === 4)!;
    const commitment = unit.commitments.find(item => item.occurrenceId === occurrence.id)!;
    expect(commitment).toMatchObject({ basis: "indentation", relationBy });
    expect(describeCommitment(unit, commitment)).toContain(`moving it can change the target; ${message}`);
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

  it.each([
    ["Q", "C", "answers", "C beneath a Question offers a candidate answer", []],
    ["Q", ".", "concerns", "Placement records relevance", []],
    ["C", "C", "concerns", "Placement records relevance", []],
    ["C", ".", "concerns", "Placement records relevance", []],
    ["Q", "G", "concerns", "Presented as Ground; support target unstated; placement records relevance", ["UNBOUND_GROUND_UNDER_QUESTION"]],
    ["C", "D", "interprets", "From indentation", []]
  ])("describes [%s] > [%s] using Core's default and framing", (focus, mark, kind, prefix, codes) => {
    const { explained, unit, commitment, text } = inspect(`- [${focus} @focus] Focus.\n  - [${mark}] Content.`, 2);
    expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(codes);
    expect(unit.graph.bearings).toHaveLength(1);
    expect(commitment).toMatchObject({ basis: "indentation", kind });
    expect(commitment.reason).toBeUndefined();
    const frame = explained.explanations[0].entries[1].effects.find(effect => effect.kind === "frameOccurrence");
    expect(commitment.frame).toEqual(frame);
    expect(text.startsWith(`${prefix}:`)).toBe(true);
    expect(text).toContain(`${kind} @focus (L1)`);
  });

  it.each([
    ["C", "Q", "answers", "question", "C beneath a Question offers a candidate answer"],
    ["Q", ".", "concerns", "point", "Placement records relevance"]
  ])("uses the focus occurrence's [%s] declaration / [%s use] framing", (declaration, use, kind, focus, prefix) => {
    const { commitment, text } = inspect(`- [${declaration} @focus] Declared.\n- [${use} use @focus]\n  - [C] Content.`, 3);
    expect(commitment).toMatchObject({ kind, frame: { framing: "aligned", focus } });
    expect(text.startsWith(`${prefix}:`)).toBe(true);
    expect(text).toContain("@focus (L2)");
  });

  it.each([
    [".", "concerns", []],
    ["C", "answers", ["IMPLICIT_ATTACHMENT_THROUGH_BODY"]],
    ["G", "concerns", ["UNBOUND_GROUND_UNDER_QUESTION"]]
  ])("retains crossed body evidence for [%s] without inventing advice", (mark, kind, codes) => {
    const { explained, commitment, text } = inspect(`- [Q] Question.\n  - Context.\n    - [${mark}] Content.`, 3);
    expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(codes);
    expect(commitment.kind).toBe(kind);
    expect(commitment.crossedOccurrenceIds).toHaveLength(1);
    expect(text).toContain("passing through ordinary body at L2");
  });

  it.each([
    ["G", "support"], ["O", "challenge"], ["R", "response"], ["D", "interpretation"]
  ])("keeps a root [%s] intention unbound without inventing a target", (mark, intention) => {
    const { unit, commitment, text } = inspect(`- [${mark}] Content.`, 1);
    expect(unit.graph.bearings).toEqual([]);
    expect(commitment).toMatchObject({ basis: "none", frame: { framing: "unbound" } });
    expect(commitment.target).toBeUndefined();
    expect(text).toContain(`${intention} target unstated; its position creates no relation.`);
  });

  it.each([
    ["G", "->", "challenges"], ["O", "+>", "supports"]
  ])("describes only the clause's relation for opposed [%s %s]", (mark, clause, kind) => {
    for (const target of ["^", "@target"]) {
      const { unit, explained, commitment, text } = inspect(`- [C @target] Target.\n  - [${mark} ${clause} ${target}] Content.`, 2);
      expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["OPPOSED_FRAMING"]);
      expect(unit.graph.bearings).toHaveLength(1);
      expect(commitment).toMatchObject({ kind, frame: { framing: "opposed" } });
      expect(commitment.frame?.focus).toBeUndefined();
      expect(text).toContain(`${kind} @target`);
      expect(text).toContain("(opposed framing)");
    }
  });

  it.each([
    ["G by example", "indentation"],
    [". +> @claim by example", "explicit"],
    ["_ +> ^ by example", "indentation"]
  ])("names the example profile for [%s]", (header, basis) => {
    const { commitment, text } = inspect(`- [C @claim] Claim.\n  - [${header}] Example.\n` +
      (header.startsWith("_") ? "    - [.] Source." : ""), 2);
    expect(commitment).toMatchObject({ basis, kind: "supports", profile: "example" });
    expect(text).toContain("supports by example @claim");
  });

  it("explains an unsupported profile as a rejection without a fallback relation", () => {
    const { unit, explained, commitment, text } = inspect("- [C] Claim.\n  - [. by example] Content.", 2);
    expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["PROFILE_REQUIRES_SUPPORTS"]);
    expect(unit.graph.bearings).toEqual([]);
    expect(commitment).toMatchObject({ basis: "failed", reason: "unsupported-profile" });
    expect(commitment.frame).toBeUndefined();
    expect(text).toBe("No relation: by example requires a supports Bearing. by example qualifies a supports Bearing, but [.] beneath this Point constructs concerns. Write a supports clause, as in [. +> ^ by example].");
  });
});
