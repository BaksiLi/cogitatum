import { describe, expect, it } from "vitest";
import { previewRelationEdit } from "./index.js";
import type { RelationEditOptions, RelationEditPreview } from "./index.js";

function ready(source: string, options: RelationEditOptions) {
  const result = previewRelationEdit(source, options);
  if (result.status !== "ready") throw new Error(`${result.reason}: ${result.message}`);
  const { offset, remove, insert } = result.edit;
  expect(source.slice(offset, offset + remove.length)).toBe(remove);
  expect(source.slice(0, offset) + insert + source.slice(offset + remove.length)).toBe(result.proposedSource);
  return result;
}

function unavailable(source: string, options: RelationEditOptions): Extract<RelationEditPreview, { status: "unavailable" }> {
  const result = previewRelationEdit(source, options);
  if (result.status !== "unavailable") throw new Error("expected an unavailable preview");
  return result;
}

const rest = "- [C] Unrelated claim.\n  - [G] Unrelated reason.\n";

describe("deciding a relation's kind", () => {
  it("refines an undecided grouping without moving its members", () => {
    const source = "- [C] Claim.\n  - [_]\n    - [. @a] A.\n      Continued.\n    - [.] B.\n" + rest;
    const result = ready(source, { operation: "decide", line: 2, kind: "supports" });
    expect(result.proposedSource).toBe(source.replace("[_]", "[_ +> ^]"));
    expect(result.edit).toEqual({ offset: source.indexOf("[_]") + 2, remove: "", insert: " +> ^" });
    expect(result.comparison).toMatchObject({ relation: "refinement", retracted: [] });
  });

  it("keeps the selector slash and named targets as written", () => {
    expect(ready("- [C] Claim.\n  - [G; @s] B.\n    - [_/]\n      - [.] C.\n", { operation: "decide", line: 3, kind: "challenges" }).proposedSource)
      .toContain("- [_ -> ^/]");
    expect(ready("- [C @c] Claim.\n- [. @a] A.\n- [_ @a ~> @c; @j]\n", { operation: "decide", line: 3, kind: "supports" }).proposedSource)
      .toContain("[_ @a +> @c; @j]");
  });

  it("swaps a relation mark for the new kind's mark, and spells a clause where a mark has other meaning", () => {
    expect(ready("- [C] Claim.\n  - [G @r; @h] A.\n", { operation: "decide", line: 2, kind: "challenges" }).proposedSource).toContain("[O @r; @h]");
    expect(ready("- [C] Claim.\n  - [G] A.\n    - [D/] B.\n", { operation: "decide", line: 3, kind: "challenges" }).proposedSource).toContain("[O/]");
    expect(ready("- [C] Claim.\n  - [G] A.\n    - [Q/] Why?\n", { operation: "decide", line: 3, kind: "challenges" }).proposedSource).toContain("[Q -> ^/]");
    expect(ready("- [Q] Why?\n  - [R] A.\n", { operation: "decide", line: 2, kind: "answers" }).proposedSource).toContain("[R answers ^]");
  });

  it("classifies a change of force as a revision and a retreat to relevance as a weakening", () => {
    expect(ready("- [C] Claim.\n  - [G] A.\n", { operation: "decide", line: 2, kind: "challenges" }).comparison.relation).toBe("revision");
    expect(ready("- [C] Claim.\n  - [_ +> ^]\n    - [.] A.\n", { operation: "decide", line: 2, kind: "concerns" }).comparison.relation).toBe("weakening");
  });

  it("keeps a relation that addresses the decided step", () => {
    const result = ready("- [C] Claim.\n  - [_]\n    - [.] A.\n    - [O/] Not so.\n", { operation: "decide", line: 2, kind: "supports" });
    expect(result.comparison.retracted).toEqual([]);
    expect(Object.keys(result.correspondence.bearings)).toHaveLength(2);
  });

  it("refuses no-op and Point-only results", () => {
    expect(unavailable("- [C] Claim.\n  - [G] A.\n", { operation: "decide", line: 2, kind: "supports" }).reason).toBe("unchanged");
    expect(unavailable("- [C] Claim.\n  - [G] A.\n    - [O/] B.\n", { operation: "decide", line: 3, kind: "respondsTo" }).reason).toBe("invalid-result");
    expect(unavailable("- [C] Claim.\n  - Body.\n", { operation: "decide", line: 2, kind: "supports" }).reason).toBe("no-relation");
  });
});

describe("separating and joining", () => {
  const joint = "- [C] Claim.\n  - [_ +> ^]\n    - [. @a] A.\n      Continued.\n      - [. note] A note.\n        - Literal.\n    - [. use @x] B.\n- [C @x] Shared.\n";
  const apart = "- [C] Claim.\n  - [G @a] A.\n    Continued.\n    - [. note] A note.\n      - Literal.\n  - [G use @x] B.\n- [C @x] Shared.\n";

  it("separates linked support into convergent supports as a revision", () => {
    const result = ready(joint, { operation: "separate", line: 2 });
    expect(result.proposedSource).toBe(apart);
    expect(result.comparison).toMatchObject({ relation: "revision", bearings: { removed: ["_b1"] } });
    expect(result.comparison.added.map(c => c.kind)).toEqual(["supports", "supports"]);
  });

  it("joins convergent supports into linked support, inverting separation", () => {
    const result = ready(apart, { operation: "join", lines: [2, 6] });
    expect(result.proposedSource).toBe(joint);
    expect(result.comparison.relation).toBe("revision");
  });

  it("separates an undecided grouping without changing what it commits to", () => {
    const result = ready("- [C] Claim.\n  - [_]\n    - [.] A.\n    - [.] B.\n", { operation: "separate", line: 2 });
    expect(result.proposedSource).toBe("- [C] Claim.\n  - [. ~> ^] A.\n  - [. ~> ^] B.\n");
    expect(result.comparison.relation).toBe("equivalent");
  });

  it("keeps tabs, root position and named targets", () => {
    expect(ready("- [C] Claim.\n\t- [G] A.\n\t- [G] B.\n", { operation: "join", lines: [2, 3] }).proposedSource)
      .toBe("- [C] Claim.\n\t- [_ +> ^]\n\t\t- [.] A.\n\t\t- [.] B.\n");
    expect(ready("- [C @c] Claim.\n- [G +> @c] A.\n- [O +> @c] B.\n", { operation: "join", lines: [2, 3] }).proposedSource)
      .toBe("- [C @c] Claim.\n- [_ +> @c]\n  - [.] A.\n  - [.] B.\n");
    expect(ready("- [C] Claim.\r\n  - [G] A.\r\n  - [G] B.", { operation: "join", lines: [2, 3] }).proposedSource)
      .toBe("- [C] Claim.\r\n  - [_ +> ^]\r\n    - [.] A.\r\n    - [.] B.");
  });

  it("refuses to drop what belongs to the joint relation or to one occurrence's relation", () => {
    expect(unavailable("- [C] Claim.\n  - [_ +> ^; @j]\n    - [.] A.\n", { operation: "separate", line: 2 }).message).toContain("handle");
    expect(unavailable("- [C] Claim.\n  - [_ +> ^] Together.\n    - [.] A.\n", { operation: "separate", line: 2 }).message).toContain("description");
    expect(unavailable("- [C] Claim.\n  - [_ +> ^]\n    - [.] A.\n    - [O/] Not jointly.\n", { operation: "separate", line: 2 }).message).toContain("Line 4");
    expect(unavailable("- [C] Claim.\n  - [G; @h] A.\n  - [G] B.\n", { operation: "join", lines: [2, 3] }).message).toContain("handle");
    // An objection to one member's own step has no step once it is a member.
    expect(unavailable("- [C] Claim.\n  - [G] A.\n    - [O/] Not so.\n  - [G] B.\n", { operation: "join", lines: [2, 4] }).reason).toBe("invalid-result");
  });

  it("joins only adjacent siblings of one kind and written target", () => {
    expect(unavailable("- [C] Claim.\n  - [G] A.\n  - Body.\n  - [G] B.\n", { operation: "join", lines: [2, 4] }).reason).toBe("not-joinable");
    expect(unavailable("- [C] Claim.\n  - [G] A.\n  - [O] B.\n", { operation: "join", lines: [2, 3] }).reason).toBe("not-joinable");
    expect(unavailable("- [C @c] Claim.\n  - [G] A.\n  - [G +> @c] B.\n", { operation: "join", lines: [2, 3] }).reason).toBe("not-joinable");
    expect(unavailable("- [C] Claim.\n  - [G] A.\n", { operation: "join", lines: [2] }).reason).toBe("not-joinable");
  });
});

describe("preview boundaries", () => {
  it("refuses sources with errors and invalid arguments", () => {
    expect(unavailable("- [C] Claim.\n  - [G +> @missing] A.\n", { operation: "decide", line: 2, kind: "concerns" }).reason).toBe("source-errors");
    expect(unavailable("- [C] Claim.\n", { operation: "decide", line: 0, kind: "concerns" }).reason).toBe("invalid-line");
    expect(unavailable("- [C] Claim.\n", { operation: "merge", line: 1 } as never).reason).toBe("invalid-operation");
  });

  it("edits a host fence in place and leaves other units unchanged", () => {
    const host = "# Notes\n\n```cog\n- [C] One.\n  - [G] A.\n  - [G] B.\n```\n\n```cog\n- [C] Two.\n```\n";
    const result = ready(host, { operation: "join", lines: [5, 6], mode: "host" });
    expect(result.proposedSource).toBe(host.replace("  - [G] A.\n  - [G] B.", "  - [_ +> ^]\n    - [.] A.\n    - [.] B."));
  });
});

describe("joining preserves what members declare and how their unit indents", () => {
  it("refuses to join Question or Claim occurrences, whose marks declare more than a relation", () => {
    expect(unavailable("- [C] Topic.\n  - [Q] Why A?\n  - [Q] Why B?\n", { operation: "join", lines: [2, 3] }).reason).toBe("not-joinable");
    expect(unavailable("- [C @c] Topic.\n- [C +> @c] A.\n- [C +> @c] B.\n", { operation: "join", lines: [2, 3] }).reason).toBe("not-joinable");
  });

  it("indents a root-level join as the selected fence nests, not as other text does", () => {
    const fence = "`".repeat(3);
    const source = `  ${fence}cog\n  - [C @c] C.\n  \t- [G] Existing.\n  - [G +> @c] A.\n  - [G +> @c] B.\n  ${fence}\n`;
    expect(ready(source, { operation: "join", lines: [4, 5], mode: "host" }).proposedSource)
      .toBe(source.replace("  - [G +> @c] A.\n  - [G +> @c] B.", "  - [_ +> @c]\n  \t- [.] A.\n  \t- [.] B."));
    const spaced = `\t- prose\n\n${fence}cog\n- [C @c] C.\n- [G +> @c] A.\n- [G +> @c] B.\n${fence}\n`;
    expect(ready(spaced, { operation: "join", lines: [5, 6], mode: "host" }).proposedSource).toContain("- [_ +> @c]\n  - [.] A.\n  - [.] B.");
  });
});
