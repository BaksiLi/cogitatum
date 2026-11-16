import { describe, expect, it } from "vitest";
import { compareCommitments } from "./commitments.js";
import type { Correspondence } from "./commitments.js";
import { compareSourceRevisions } from "./source-comparison.js";
import type { PresentationChange, SourceComparison } from "./source-comparison.js";
import { explainSource } from "./source.js";
import type { ExplainedSource } from "./types.js";

const none: Correspondence = { points: {}, bearings: {} };
const one: Correspondence = { points: { _p1: "_p1" }, bearings: {} };
const pair: Correspondence = { points: { _p1: "_p1", _p2: "_p2" }, bearings: { _b1: "_b1" } };
const claim = "- [C @claim] A claim.";

function source(text: string, mode: "document" | "host" = "document") {
  const result = explainSource(text, mode);
  expect(result.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  return result;
}

function compared(result: SourceComparison) {
  if (result.status !== "compared") throw new Error(result.message);
  return result;
}

function compare(before: string, after: string, lines: Record<number, number>, correspondence = none) {
  return compared(compareSourceRevisions(source(before), source(after), { unitIndex: 0, correspondence, lines }));
}

function changed(result: SourceComparison): Extract<PresentationChange, { kind: "changed" }> {
  const changes = compared(result).presentationChanges;
  expect(changes).toHaveLength(1);
  if (changes[0].kind !== "changed") throw new Error("Expected one continued occurrence to change.");
  return changes[0];
}

describe("source revision evidence beyond commitments", () => {
  it("returns the commitment comparison unchanged alongside O -> G framing evidence", () => {
    const before = source(claim + "\n  - [O +> ^] A reason.");
    const after = source(claim + "\n  - [G +> ^] A reason.");
    const result = compared(compareSourceRevisions(before, after, { unitIndex: 0, correspondence: pair, lines: { 1: 1, 2: 2 } }));
    const { presentationChanges, ...commitments } = result;
    expect(commitments).toEqual(compareCommitments(before.graphs[0], after.graphs[0], pair));
    expect(result.relation).toBe("equivalent");
    expect(presentationChanges).toHaveLength(1);
    expect(changed(result)).toMatchObject({
      mark: true, fit: true, intention: false, content: false,
      before: { sourceSpan: before.documents[0].blocks[0].children[0].sourceSpan, recognition: { kind: "role", role: "O" }, framing: { fit: "opposed", intention: "bound" } },
      after: { sourceSpan: after.documents[0].blocks[0].children[0].sourceSpan, recognition: { kind: "role", role: "G" }, framing: { fit: "home", intention: "bound" } }
    });
    expect(changed(result).before.framing).not.toHaveProperty("kind");
    expect(changed(result).before.framing).not.toHaveProperty("focus");
  });

  it("compares use-site marks without changing the shared Point's declaration", () => {
    const before = "- [. @shared] Shared content.\n" + claim + "\n  - [O use @shared +> ^] Local wording.";
    const after = before.replace("[O use", "[G use");
    const result = compare(before, after, { 1: 1, 2: 2, 3: 3 }, pair);
    expect(result).toMatchObject({ relation: "equivalent", points: { changed: [] } });
    expect(changed(result)).toMatchObject({
      mark: true, fit: true, intention: false,
      before: { recognition: { kind: "use", role: "O", ref: { id: "shared" } } },
      after: { recognition: { kind: "use", role: "G", ref: { id: "shared" } } }
    });
  });

  it("reports intention independently of fit, with structured unbound and none values", () => {
    const result = compare("- [O] A remark.", "- [.] A remark.", { 1: 1 }, one);
    expect(result.relation).toBe("equivalent");
    expect(changed(result)).toMatchObject({
      mark: true, fit: false, intention: true, content: false,
      before: { framing: { intention: "unbound", awaits: "challenges" } },
      after: { framing: { intention: "none" } }
    });
    const awaits = compare("- [O] A remark.", "- [G] A remark.", { 1: 1 }, one);
    expect(changed(awaits)).toMatchObject({ intention: true, before: { framing: { awaits: "challenges" } }, after: { framing: { awaits: "supports" } } });
  });

  it("compares Note prose and all literal descendants once at the Note root", () => {
    const before = claim + "\n  - [note] An aside.\n    - [O] Literal quotation.\n      - Nested wording.";
    const after = before.replace("An aside.", "An edited aside.").replace("Nested wording.", "Edited nested wording.");
    const result = compare(before, after, { 1: 1, 2: 2 }, one);
    expect(result).toMatchObject({ relation: "equivalent", points: { changed: [] } });
    expect(changed(result)).toMatchObject({
      content: true, mark: false, fit: false, intention: false,
      before: { sourceSpan: { startLine: 2 }, text: "An aside.", literalChildren: [{ text: "[O] Literal quotation.", children: [{ text: "Nested wording.", children: [] }] }] },
      after: { sourceSpan: { startLine: 2 }, text: "An edited aside.", literalChildren: [{ children: [{ text: "Edited nested wording." }] }] }
    });
  });

  it("sees a literal-only Note edit even when its own text and all Graph entities agree", () => {
    const before = claim + "\n  - [note] Aside.\n    - [G +> @not-a-reference] Quoted syntax.";
    const after = before.replace("Quoted syntax.", "Revised quotation.");
    expect(source(before).graphs[0]).toEqual(source(after).graphs[0]);
    expect(changed(compare(before, after, { 1: 1, 2: 2 }, one))).toMatchObject({ content: true, before: { text: "Aside." }, after: { text: "Aside." } });
  });

  it("reports plain body and continuation prose changes", () => {
    const before = claim + "\n  - Ordinary body.\n    Continued wording.";
    const after = before.replace("Continued wording.", "Revised wording.");
    const result = compare(before, after, { 1: 1, 2: 2 }, one);
    expect(result.relation).toBe("equivalent");
    expect(changed(result)).toMatchObject({
      content: true, mark: false, fit: false, intention: false,
      before: { recognition: { kind: "body" }, text: "Ordinary body.\nContinued wording." },
      after: { recognition: { kind: "body" }, text: "Ordinary body.\nRevised wording." }
    });
  });

  it("reports removals and additions of active occurrences, including a use and body", () => {
    const before = claim + "\n- [O use @claim]\n- Old body.";
    const after = claim + "\n- [G use @claim]\n- New body.";
    const result = compare(before, after, { 1: 1 }, one);
    expect(result).toMatchObject({ relation: "equivalent", points: { removed: [], added: [] } });
    expect(result.presentationChanges).toMatchObject([
      { kind: "removed", before: { recognition: { kind: "use", role: "O" }, sourceSpan: { startLine: 2 } } },
      { kind: "removed", before: { text: "Old body." } },
      { kind: "added", after: { recognition: { kind: "use", role: "G" }, sourceSpan: { startLine: 2 } } },
      { kind: "added", after: { text: "New body." } }
    ]);
  });

  it("does not infer source continuity from identical text, names, lines or Graph keys", () => {
    const text = "- [C @same] Same.\n- Same.\n- Same.";
    const result = compare(text, text, {}, one);
    expect(result.relation).toBe("equivalent");
    expect(result.presentationChanges.map(c => c.kind)).toEqual(["removed", "removed", "removed", "added", "added", "added"]);
    expect(compare(text, text, { 1: 1, 2: 3, 3: 2 }, one).presentationChanges).toEqual([]);
  });

  it("does not count line/column movement, including Note literals, as a change", () => {
    const before = source("```cog\n" + claim + "\n  - Ordinary body.\n  - [note] Aside.\n    - Literal.\n```", "host");
    const after = source("Host introduction.\n\n  ```cog\n  " + claim + "\n    - Ordinary body.\n    - [note] Aside.\n      - Literal.\n  ```", "host");
    const result = compared(compareSourceRevisions(before, after, { unitIndex: 0, correspondence: one, lines: { 2: 4, 3: 5, 4: 6 } }));
    expect(before.explanations[0].entries[0].sourceSpan).not.toEqual(after.explanations[0].entries[0].sourceSpan);
    expect(result).toMatchObject({ relation: "equivalent", presentationChanges: [] });
  });

  it("normalizes annotation spacing instead of labelling it as changed intent", () => {
    const before = claim + "\n  - [G +> @claim; @step] A reason.";
    const after = claim + "\n  - [ G   +>   @claim ;   @step ] A reason.";
    expect(compare(before, after, { 1: 1, 2: 2 }, pair).presentationChanges).toEqual([]);
  });

  it("reports relation provenance and target writing without borrowing entity keys", () => {
    const before = claim + "\n  - [G] A reason.";
    const after = claim + "\n  - [G +> @claim] A reason.";
    const result = compare(before, after, { 1: 1, 2: 2 }, pair);
    expect(result.relation).toBe("equivalent");
    expect(changed(result)).toMatchObject({
      mark: false, fit: false, intention: false, annotation: true, provenance: true,
      before: { relations: [{ reason: "annotated-containment", targetBy: "position" }] },
      after: { annotation: { operatorClause: { op: "supports", sources: "self", target: { id: "claim" } } }, relations: [{ reason: "operator-clause", targetBy: "name" }] }
    });
    expect(JSON.stringify(result.presentationChanges)).not.toMatch(/"(?:key|graphIndex)":/);
  });

  it("does not mistake Explain context focus for semantic framing", () => {
    const before = "- [C @context] Context.\n  - [C] A statement.";
    const after = before.replace("[C @context]", "[Q @context]");
    const correspondence: Correspondence = { points: pair.points, bearings: {} };
    const result = compare(before, after, { 1: 1, 2: 2 }, correspondence);
    expect(result.presentationChanges).toMatchObject([
      { kind: "changed", mark: true },
      { kind: "changed", mark: false, fit: false, intention: true }
    ]);
    const focusBefore = source("- [C @context] Context.\n  - [R] A reply.");
    const focusAfter = source("- [Q @context] Context.\n  - [R] A reply.");
    const focusResult = compared(compareSourceRevisions(focusBefore, focusAfter, { unitIndex: 0, correspondence: pair, lines: { 1: 1, 2: 2 } }));
    expect(focusResult.presentationChanges).toHaveLength(1);
    expect(focusResult.presentationChanges[0]).toMatchObject({ before: { sourceSpan: { startLine: 1 } } });
  });

  it("keeps equivalent a statement about commitments when Point or body prose changes", () => {
    const result = compare(claim + "\n- Body.", claim.replace("A claim.", "A revised claim.") + "\n- Revised body.", { 1: 1, 2: 2 }, one);
    expect(result).toMatchObject({ relation: "equivalent", points: { changed: [{ text: true, declaration: false }] } });
    expect(result.presentationChanges).toHaveLength(2);
    expect(result.presentationChanges.every(change => change.kind === "changed" && change.content)).toBe(true);
  });
});

describe("authored object Note target changes", () => {
  const pointNote = "- [. @p] Observation.\n  - [. note] Treat cautiously.\n- [C @q] Conclusion.";
  const pointCorrespondence: Correspondence = { points: pair.points, bearings: {} };
  const bearingNote = "- [. @p] Observation.\n- [C @q] Conclusion.\n- [_ @p +> @q; @first]\n  - [_ note] Treat cautiously.\n- [_ @p +> @q; @second]";
  const bearingCorrespondence: Correspondence = { points: pair.points, bearings: { _b1: "_b1", _b2: "_b2" } };
  const unchangedFlags = { mark: false, fit: false, intention: false, content: false, annotation: false, provenance: false };

  it("reports a continued Note moving between Points with unchanged prose and commitments", () => {
    const after = "- [. @p] Observation.\n- [C @q] Conclusion.\n  - [. note] Treat cautiously.";
    const result = compare(pointNote, after, { 1: 1, 2: 3, 3: 2 }, pointCorrespondence);
    expect(result).toMatchObject({ relation: "equivalent", points: { changed: [] }, bearings: { changed: [] } });
    expect(changed(result)).toMatchObject({
      ...unchangedFlags, noteTarget: true,
      before: { noteTarget: { kind: "point", key: "_p1" } },
      after: { noteTarget: { kind: "point", key: "_p2" } }
    });
  });

  it("distinguishes Notes on parallel Bearings with identical endpoints", () => {
    const after = "- [. @p] Observation.\n- [C @q] Conclusion.\n- [_ @p +> @q; @first]\n- [_ @p +> @q; @second]\n  - [_ note] Treat cautiously.";
    const result = compare(bearingNote, after, { 1: 1, 2: 2, 3: 3, 4: 5, 5: 4 }, bearingCorrespondence);
    expect(result).toMatchObject({ relation: "equivalent", bearings: { changed: [] } });
    expect(changed(result)).toMatchObject({
      ...unchangedFlags, noteTarget: true,
      before: { noteTarget: { kind: "bearing", key: "_b1" } },
      after: { noteTarget: { kind: "bearing", key: "_b2" } }
    });
  });

  it("reports switching between the Point and Bearing slots of one context", () => {
    const before = claim + "\n  - [G @reason; @step] A reason.\n    - [. note] Treat cautiously.";
    const result = compare(before, before.replace("[. note]", "[_ note]"), { 1: 1, 2: 2, 3: 3 }, pair);
    expect(result.relation).toBe("equivalent");
    expect(changed(result)).toMatchObject({
      noteTarget: true, content: false,
      before: { noteTarget: { kind: "point", key: "_p2" } },
      after: { noteTarget: { kind: "bearing", key: "_b1" } }
    });
  });

  it.each([". note", "_ note"])("reports adding and removing typed targeting with [%s]", header => {
    const plain = claim + "\n  - [G @reason; @step] A reason.\n    - [note] Treat cautiously.\n      - [G] Literal quotation.";
    const typed = plain.replace("[note]", `[${header}]`);
    const lines = { 1: 1, 2: 2, 3: 3 };
    const added = changed(compare(plain, typed, lines, pair));
    const removed = changed(compare(typed, plain, lines, pair));
    expect(added).toMatchObject({ noteTarget: true, content: false });
    expect(added.before).not.toHaveProperty("noteTarget");
    expect(added.after.noteTarget?.kind).toBe(header === ". note" ? "point" : "bearing");
    expect(removed).toMatchObject({ noteTarget: true, content: false });
    expect(removed.before.noteTarget).toEqual(added.after.noteTarget);
    expect(removed.after).not.toHaveProperty("noteTarget");
  });

  it("continues a Point Note through coordinate movement and key renumbering", () => {
    const after = "\n- [C @q] Conclusion.\n- [. @p] Observation.\n  - [. note] Treat cautiously.";
    const result = compare(pointNote, after, { 1: 3, 2: 4, 3: 2 }, {
      points: { _p1: "_p2", _p2: "_p1" }, bearings: {}
    });
    expect(result).toMatchObject({ relation: "equivalent", presentationChanges: [] });
  });

  it("continues a Bearing Note when both Point and Bearing keys are renumbered", () => {
    const after = "\n- [C @q] Conclusion.\n- [. @p] Observation.\n- [_ @p +> @q; @second]\n- [_ @p +> @q; @first]\n  - [_ note] Treat cautiously.";
    const result = compare(bearingNote, after, { 1: 3, 2: 2, 3: 5, 4: 6, 5: 4 }, {
      points: { _p1: "_p2", _p2: "_p1" }, bearings: { _b1: "_b2", _b2: "_b1" }
    });
    expect(result).toMatchObject({ relation: "equivalent", presentationChanges: [] });
  });

  it.each(["point", "bearing"] as const)("requires explicit %s target continuity even when generated keys agree", kind => {
    const text = kind === "point" ? pointNote : bearingNote;
    const lines = kind === "point" ? { 1: 1, 2: 2, 3: 3 } : { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
    const correspondence = kind === "point" ? { points: { _p2: "_p2" }, bearings: {} }
      : { points: pair.points, bearings: { _b2: "_b2" } };
    const change = changed(compare(text, text, lines, correspondence));
    expect(change).toMatchObject({ ...unchangedFlags, noteTarget: true });
    expect(change.before.noteTarget).toEqual(change.after.noteTarget);
  });

  it("omits the optional change flag when a typed Note only changes prose", () => {
    const result = compare(pointNote, pointNote.replace("Treat cautiously.", "Observation withdrawn."), { 1: 1, 2: 2, 3: 3 }, pointCorrespondence);
    const change = changed(result);
    expect(change).toMatchObject({ content: true });
    expect(change.before.noteTarget).toEqual(change.after.noteTarget);
    expect(change).not.toHaveProperty("noteTarget");
  });

  it("does not treat constructor descriptions as authored object Notes", () => {
    const text = "- [. @p] Observation.\n- [C @q] Conclusion.\n- [_ @p +> @q; @step] Route description.";
    expect(source(text).graphs[0].notes).toMatchObject([{ origin: "constructor-description" }]);
    const result = compare(text, text, { 1: 1, 2: 2, 3: 3 }, pointCorrespondence);
    expect(result).toMatchObject({ relation: "equivalent", presentationChanges: [] });
  });
});

describe("source correspondence boundaries", () => {
  const text = claim + "\n  - Body.\n    Continued.\n  - [note] Aside.\n    - Literal.";

  it.each([
    ["a continuation line", { 3: 2 }],
    ["a literal Note descendant", { 5: 2 }],
    ["a later literal Note descendant", { 2: 5 }],
    ["a missing line", { 99: 2 }],
    ["an ambiguous many-to-one map", { 1: 2, 2: 2 }],
    ["a fractional line", { 1: 1.5 }],
    ["an alias of a line number", { "01": 1 }]
  ])("is indeterminate for %s", (_label, lines) => {
    const result = compareSourceRevisions(source(text), source(text), { unitIndex: 0, correspondence: one, lines: lines as Record<number, number> });
    expect(result).toMatchObject({ status: "indeterminate", reason: "invalid-source-correspondence" });
    expect(result).not.toHaveProperty("presentationChanges");
  });

  it("accepts exactly the active Explain entry domain, omitting literal children", () => {
    const before = source(text), after = source("\n" + text);
    const lines = Object.fromEntries(before.explanations[0].entries.map(entry => [entry.sourceSpan.startLine, entry.sourceSpan.startLine + 1]));
    expect(compared(compareSourceRevisions(before, after, { unitIndex: 0, correspondence: one, lines })).presentationChanges).toEqual([]);
  });

  it("rejects ambiguous or incomplete AST/Explain occurrence evidence", () => {
    const before = source(text), after = source(text);
    before.explanations[0].entries.push(before.explanations[0].entries[0]);
    expect(compareSourceRevisions(before, after, { unitIndex: 0, correspondence: one, lines: {} })).toMatchObject({ reason: "invalid-source-correspondence" });
    before.explanations[0].entries = [];
    expect(compareSourceRevisions(before, after, { unitIndex: 0, correspondence: one, lines: {} })).toMatchObject({ reason: "invalid-source-correspondence" });
  });

  it("compares only the selected host unit in complete-input coordinates", () => {
    const before = source("```cog\n- [C] First.\n```\n\n```cog\n- [C] Second.\n- Body.\n```", "host");
    const after = source("Host prose.\n```cog\n- [C] Unrelated edit.\n```\n\n```cog\n- [C] Second.\n- Edited body.\n```", "host");
    const result = compared(compareSourceRevisions(before, after, { unitIndex: 1, correspondence: one, lines: { 6: 7, 7: 8 } }));
    expect(result.relation).toBe("equivalent");
    expect(changed(result)).toMatchObject({ content: true, before: { sourceSpan: { startLine: 7 } }, after: { sourceSpan: { startLine: 8 } } });
    expect(compareSourceRevisions(before, after, { unitIndex: 1, correspondence: one, lines: { 2: 3 } })).toMatchObject({ reason: "invalid-source-correspondence" });
  });

  it("does not let errors in another host unit classify the selected unit", () => {
    const before = explainSource("```cog\n- [G +> @missing] Broken.\n```\n```cog\n" + claim + "\n```", "host");
    const result = compared(compareSourceRevisions(before, before, { unitIndex: 1, correspondence: one, lines: { 5: 5 } }));
    expect(result).toMatchObject({ relation: "equivalent", presentationChanges: [] });
  });

  it.each([-1, 0.5, 1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("requires an existing integer unit index: %s", unitIndex => {
    const before = source(claim);
    expect(compareSourceRevisions(before, before, { unitIndex, correspondence: one, lines: {} })).toMatchObject({ status: "indeterminate", reason: "invalid-source-correspondence" });
  });

  it("validates parse modes and every selected projection version", () => {
    const before = source(claim);
    const options = { unitIndex: 0, correspondence: one, lines: { 1: 1 } };
    expect(compareSourceRevisions(before, source("```cog\n" + claim + "\n```", "host"), options)).toMatchObject({ reason: "invalid-source-correspondence" });
    expect(compareSourceRevisions({ ...before, mode: "auto" as ExplainedSource["mode"] }, { ...before, mode: "auto" as ExplainedSource["mode"] }, options)).toMatchObject({ reason: "invalid-source-correspondence" });
    expect(compareSourceRevisions({ ...before, version: "0.6.0" }, before, options)).toMatchObject({ reason: "unsupported-version" });
    for (const field of ["documents", "graphs", "explanations"] as const) {
      const older = structuredClone(before);
      older[field][0].version = "0.6.0";
      expect(compareSourceRevisions(before, older, options)).toMatchObject({ reason: "unsupported-version" });
      const missing = structuredClone(before);
      missing[field] = [];
      expect(compareSourceRevisions(before, missing, options)).toMatchObject({ reason: "invalid-source-correspondence" });
    }
  });

  it("preserves graph-error and graph-correspondence indeterminacy", () => {
    const before = source(claim), partial = explainSource("- [G +> @missing] Broken.");
    expect(compareSourceRevisions(before, partial, { unitIndex: 0, correspondence: none, lines: {} })).toMatchObject({ status: "indeterminate", reason: "source-errors" });
    expect(compareSourceRevisions(before, before, { unitIndex: 0, correspondence: { points: { missing: "_p1" }, bearings: {} }, lines: {} })).toMatchObject({ status: "indeterminate", reason: "invalid-correspondence" });
    const two = source(claim + "\n- [.] Another.");
    expect(compareSourceRevisions(two, before, { unitIndex: 0, correspondence: { points: { _p1: "_p1", _p2: "_p1" }, bearings: {} }, lines: {} })).toMatchObject({ reason: "invalid-correspondence" });
  });
});
