import { describe, expect, it } from "vitest";
import { explainSource, formatExplain } from "./index.js";

describe("readable compiler decisions", () => {
  it("shows selected context, transparent body, ordered members, commentary and exact note targets", () => {
    const result = formatExplain(explainSource(`- [C @claim] Claim.
  - Context.
    - [_ +> ^; @joint] Joint description.
      - [. @first] First source.
      - [. @second] Second source.
      - [_ -> ^/; @review]
        - [.] Review source.
        - [_ note] Review note.
      - [Q/] Which scope?
        - [R] This scope.
- [_ use @joint]
  - [G/] Backing.`));
    expect(result).toContain("status: no-errors");
    expect(result).toContain("3:7-3:42 bearing member sources");
    expect(result).toContain("6:9-6:27 bearing member sources");
    expect(result).toContain("9:9-9:26 role Q/");
    expect(result).toContain("11:3-11:17 bearingUse");
    expect(result).toContain("through ordinary body at 2:5-2:13");
    expect(result).toContain("supports([point @first");
    expect(result).toContain(", point @second");
    expect(result).toContain("commentary, not a source");
    expect(result).toContain("Object note belongs to bearing @review");
    expect(result).toContain("respondsTo([");
    expect(result).toContain("Select referenced Bearing from use at");
    expect(result).toContain("IMPLICIT_ATTACHMENT_THROUGH_BODY");
  });

  it("prints failures without describing candidates as surviving entities", () => {
    const result = formatExplain(explainSource("- [C @claim] Claim.\n  - [G +> @missing; @bad] Failed.\n    - [O/] Review.\n- [Q] Which scale?"));
    expect(result).toContain("status: partial");
    expect(result).toContain("candidate supports(");
    expect(result).toContain("unresolved @missing");
    expect(result).toContain('unavailable bearing "_b1"');
    expect(result).toContain("Reject Bearing: validation-error");
    expect(result).toContain("No Bearing: no-eligible-ancestor");
    expect(result).not.toContain("Construct bearing @bad");
  });

  it("identifies the surviving header for each occurrence of a reused source", () => {
    const result = formatExplain(explainSource(`- [. @shared] Shared source.
- [C] Claim.
  - [_ +> ^; @first]
    - [. use @shared]
  - [_ +> ^; @second]
    - [. use @shared]`));
    const memberships = result.split("\n").filter(line => line.includes("eligible;"));
    expect(memberships).toHaveLength(2);
    expect(memberships[0]).toContain("included in bearing @first at 3:");
    expect(memberships[1]).toContain("included in bearing @second at 5:");
  });

  it.each([
    ["  - [_ +> ^; @joint]\n    - [. @a] Source.\n    - [O] Invalid member.", "invalid-local-bearing"],
    ["  - [_ +> ^; @joint]\n    - [. @a] Source.\n    - [. use @missing] Missing source.", "validation-error"],
    ["  - [_ +> ^; @joint]\n    - [. @a] Source.\n    - [. use @a] Repeated identity.", "validation-error"]
  ])("separates source eligibility from a rejected construction", (body, reason) => {
    const result = formatExplain(explainSource("- [C] Claim.\n" + body));
    const memberships = result.split("\n").filter(line => line.includes("eligible;"));
    expect(memberships.length).toBeGreaterThan(0);
    expect(memberships.every(line => line.includes(`no Bearing was created by the rejected header (${reason})`))).toBe(true);
    expect(result).not.toContain("included in bearing @joint");
  });

  it("includes independent namespaces and host selection failures, even without any selected unit", () => {
    const source = "Prose.\n```cog\n- [C @p] First.\n```\n```cog\n- [C @p] Second.\n```\n```cog\n- [C] Unclosed.";
    const result = formatExplain(explainSource(source, "host"));
    expect(result).toContain("unit 1: fence at lines 3-3");
    expect(result).toContain("unit 2: fence at lines 6-6");
    expect(result).toContain("UNCLOSED_COGITATUM_FENCE");
    expect(formatExplain(explainSource("```cog\n- [C] Unclosed.", "host"))).toContain("UNCLOSED_COGITATUM_FENCE");
  });

  it("quotes diagnostics so authored terminal controls cannot forge records", () => {
    const result = formatExplain(explainSource("- [G +> @\u202Eevil\u001b] Invalid."));
    expect(result).toContain("\\u202e");
    expect(result).toContain("\\u001b");
    expect(result).not.toContain("\u202E");
    expect(result).not.toContain("\u001b");
  });
});
