import { describe, expect, it, vi } from "vitest";
import { explainSource, formatGraph, previewTargetForm } from "./index.js";
import type { TargetForm, TargetFormPreview } from "./index.js";
import * as sourceModule from "./source.js";

function ready(result: TargetFormPreview) {
  expect(result.status, JSON.stringify(result)).toBe("ready");
  if (result.status !== "ready") throw new Error(result.message);
  const { offset, remove, insert } = result.edit;
  expect(result.originalSource.slice(offset, offset + remove.length)).toBe(remove);
  expect(result.originalSource.slice(0, offset) + insert + result.originalSource.slice(offset + remove.length)).toBe(result.proposedSource);
  expect(result.proposedDiagnostics.some(d => d.severity === "error")).toBe(false);
  // The edit is minimal: it neither starts nor ends with text it keeps.
  if (remove && insert) expect([remove[0], remove.at(-1)]).not.toContainEqual(insert[0] === remove[0] ? insert[0] : insert.at(-1));
  return result;
}

/** Name the target at line, then make it positional again; both must be one-header edits. */
function roundTrip(source: string, line: number, named: string, positional: string, mode?: "host") {
  expect(source.split(positional)).toHaveLength(2);
  const toNamed = ready(previewTargetForm(source, { line, form: "named", mode }));
  expect(toNamed.proposedSource).toBe(source.replace(positional, named));
  expect(toNamed.consequence).toContain("Sources, members and their order are unchanged.");
  const toPositional = ready(previewTargetForm(toNamed.proposedSource, { line, form: "positional", mode }));
  expect(toPositional.proposedSource).toBe(source);
  expect(toPositional.consequence).toContain("nearest semantic context");
  return toNamed;
}

describe("target-form previews", () => {
  it.each([
    ["G", "+>", "@reason"], ["O", "->", "@reason"], ["R", "respondsTo", "@reason"], ["D", "clarifies", "@reason"], ["Q", "~>", "@reason"],
    ["G/", "+>", "@step"], ["O/", "->", "@step"], ["Q/", "~>", "@step"], ["D/", "clarifies", "@step"]
  ])("names and restores the target of [%s]", (mark, operator, target) => {
    const source = `- [C @claim] Claim.
  - [G @reason; @step] Reason.
    - [${mark} @x; @h] Local prose
      continued here.
      - [. note] Point note.
        - [G @hidden] Literal.
      - [G] Discuss this Point.`;
    const named = roundTrip(source, 3, `[${mark[0]} @x ${operator} ${target}; @h]`, `[${mark} @x; @h]`);
    expect(named.consequence).toContain(`fixed as ${target}`);
    // Only the target term changes in the graph: the Bearing keeps its endpoints.
    const before = explainSource(source).graphs[0], after = explainSource(named.proposedSource).graphs[0];
    expect(after.bearings.map(b => [b.kind, b.sources, b.target, b.handle])).toEqual(before.bearings.map(b => [b.kind, b.sources, b.target, b.handle]));
    expect(after.notes).toEqual(before.notes);
  });

  it("keeps a clause that its mark does not abbreviate, including the authored operator spelling", () => {
    roundTrip("- [C @c] Claim.\n  - [Q supports ^] Why would it hold?", 2, "[Q supports @c]", "[Q supports ^]");
    roundTrip("- [C @c] Claim.\n  - [. @r +> ^] Reason.", 2, "[. @r +> @c]", "[. @r +> ^]");
    roundTrip("- [. @shared] Shared.\n- [C @c] Claim.\n  - [O use @shared] Occurrence.", 3, "[O use @shared -> @c]", "[O use @shared]");
    roundTrip("- [Q @q] Which scale?\n  - [C answers ^] Seconds.", 2, "[C answers @q]", "[C answers ^]");
  });

  it("abbreviates a positional result only where the mark states that relation", () => {
    const result = ready(previewTargetForm("- [C @c] Claim.\n  - [G supports @c] Reason.", { line: 2, form: "positional" }));
    expect(result.proposedSource).toContain("[G] Reason.");
    expect(result.consequence).toContain("The mark states the relation again");
  });

  it.each(["_", "bearing", "edge"])("retargets a %s constructor without moving its members", family => {
    const members = "\n    - [. @a] First.\n      - [G] Anonymous reason.\n    - [. use @shared] Occurrence.\n    - [_ note] Joint note.\n    - [Q/] What scope?";
    const source = `- [. @shared] Shared.\n- [C @c] Claim.\n  - [${family} +> ^; @joint] Together.\n    A second line.${members}`;
    const named = roundTrip(source, 3, `[${family} +> @c; @joint]`, `[${family} +> ^; @joint]`);
    expect(named.proposedSource.endsWith(members)).toBe(true);
    const before = explainSource(source).graphs[0], after = explainSource(named.proposedSource).graphs[0];
    expect(after.bearings.find(b => b.handle === "joint")!.sources).toEqual(before.bearings.find(b => b.handle === "joint")!.sources);
  });

  it("spells the shortest constructor forms [_] and [_/]", () => {
    const members = "\n      - [. @a] A.\n      - [. @b] B.";
    roundTrip(`- [C @c] Claim.\n  - [G @r; @s] Reason.\n    - [_]${members}`, 3, "[_ ~> @r]", "[_]");
    roundTrip(`- [C @c] Claim.\n  - [G; @s] Reason.\n    - [_/]${members}`, 3, "[_ ~> @s]", "[_/]");
  });

  it("retargets listed-source constructors without touching their sources", () => {
    roundTrip("- [. @a] A.\n- [. @b] B.\n- [C @c] Claim.\n  - [_ @a, @b +> ^]", 4, "[_ @a, @b +> @c]", "[_ @a, @b +> ^]");
  });

  it.each(["\n", "\r\n", "\r", "mixed"])("preserves host source, fences, namespaces and original %j separators", ending => {
    const content = [
      "Host 😀.", "  ```cog", "  - [C @claim] Claim.", "  \t- [G; @step] Reason.",
      "  \t\t- [_ -> ^/; @review] Joint review.", "  \t\t\t- [. @a] First.",
      "  \t\t\t  Continued.", "  \t\t\t- [. @b] Second.", "  \t\t\t  \u2028 stays content.",
      "  ```", "Surrounding prose.", "```cog", "- [C @claim] Other namespace.", "```"
    ];
    const source = content.map((l, i) => l + (i === content.length - 1 ? "" : ending === "mixed" ? ["\n", "\r\n", "\r"][i % 3] : ending)).join("");
    const named = roundTrip(source, 5, "[_ -> @step; @review]", "[_ -> ^/; @review]", "host");
    expect(explainSource(named.proposedSource, "host").graphs[1]).toEqual(explainSource(source, "host").graphs[1]);
  });

  it.each([
    ["anonymous target", "- [C] Claim.\n  - [G] Reason.", 2, "named", "unnamed-target"],
    ["unnamed Bearing target", "- [C @c] Claim.\n  - [G] Reason.\n    - [O/] Bad step.", 3, "named", "unnamed-target"],
    ["constructor member", "- [C @c] Claim.\n  - [_ +> ^]\n    - [. @a] Reason.", 3, "named", "no-bearing"],
    ["Point inside a note", "- [C @c] Claim.\n  - [G] Reason.\n    - [note] Literal.\n      - [G +> @c] Inert.", 4, "named", "no-bearing"],
    ["plain body", "- [C @c] Claim.\n  - Plain body.", 2, "named", "no-bearing"],
    ["Claim under a Question", "- [Q @q] Which scale?\n  - [C] Seconds.", 2, "named", "no-bearing"],
    ["neutral answer fragment", "- [Q @q] Which scale?\n  - [.] Seconds.", 2, "named", "no-bearing"],
    ["missing line", "- [C @c] Claim.", 100, "named", "no-bearing"],
    ["unattached root", "- [G] Reason.", 1, "named", "no-bearing"],
    ["literal descendant", "- [C @c] Claim.\n  - [note] Literal.\n    - [G] Inert.", 3, "named", "no-bearing"],
    ["Claim without relation", "- [C @c] Claim.", 1, "named", "no-bearing"],
    ["wrong nearer target", "- [C @a] A.\n- [C @b] B.\n  - [G +> @a] Reason.", 3, "positional", "preservation-failed"],
    ["no positional target", "- [. @a] A.\n- [C @c] Claim.\n- [_ @a +> @c]", 3, "positional", "preservation-failed"],
    ["other errors", "- [C @c] Claim.\n  - [G] Reason.\n- [O -> @missing] Bad.", 2, "named", "source-errors"],
    ["already named", "- [C @c] Claim.\n  - [G +> @c] Reason.", 2, "named", "already-named"],
    ["already positional", "- [C @c] Claim.\n  - [G] Reason.", 2, "positional", "already-positional"],
    ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(line => ["invalid line", "- [C @c] Claim.", line, "named", "invalid-line"] as const),
    ["invalid form", "- [C @c] Claim.", 1, "local", "invalid-form"]
  ] as const)("declines %s with no partial result", (_name, source, line, form, reason) => {
    const result = previewTargetForm(source, { line, form: form as TargetForm });
    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(result).not.toHaveProperty("edit");
    expect(result).not.toHaveProperty("proposedSource");
  });

  it.each(["text", "member order", "note ownership", "source order", "provenance", "diagnostic"])("rejects unexpected changes to %s", change => {
    const original = sourceModule.explainSource;
    const spy = vi.spyOn(sourceModule, "explainSource").mockImplementation((source, mode) => {
      const result = original(source, mode);
      if (source.includes("[_ +> @c; @joint]")) {
        if (change === "text") result.graphs[0].points[0].text = "Changed.";
        if (change === "member order") result.documents[0].blocks[0].children[0].children.reverse();
        if (change === "note ownership") result.graphs[0].notes[0].target = { kind: "point", key: result.graphs[0].points[0].key };
        if (change === "source order") result.graphs[0].bearings[0].sources.reverse();
        if (change === "provenance") result.graphs[0].bearings[0].derivedBy = "structural";
        if (change === "diagnostic") result.diagnostics.push({ severity: "suggestion", code: "UNEXPECTED", message: "New concern." });
      }
      return result;
    });
    try {
      const result = previewTargetForm("- [C @c] Claim.\n  - [_ +> ^; @joint]\n    - [. @a] A.\n    - [. @b] B.\n    - [_ note] Step note.", { line: 2, form: "named" });
      expect(result).toMatchObject({ status: "unavailable", reason: "preservation-failed" });
    } finally { spy.mockRestore(); }
  });
  // Naming the target of a mark default writes out the relation the mark implied.
  describe("naming a mark's implied target", () => {
    it.each(["\u2028", "\u2029"])("preserves %j in prose, literal boundaries and occurrence identity", separator => {
      const source = [
        "- [. @shared] Shared " + separator + " content.",
        "- [C @claim] Claim.",
        "  - [G use @shared; @step] Local " + separator + " qualification.",
        "    - [note] Literal " + separator + " explanation.",
        "      - [G @shared +> @missing] Inert duplicate and unresolved target.",
        "    - [O/] Review this occurrence's attachment."
      ].join("\n");
      const before = explainSource(source);
      expect(before.diagnostics).toEqual([]);
      const preview = ready(previewTargetForm(source, { line: 3, form: "named" }));
      expect(preview.edit).toEqual({ offset: source.indexOf("; @step"), remove: "", insert: " +> @claim" });
      expect(preview.proposedDiagnostics).toEqual([]);
      expect(formatGraph(explainSource(preview.proposedSource).graphs[0])).toBe(formatGraph(before.graphs[0]));
    });

    it.each([["G", "+>"], ["O", "->"], ["Q", "~>"], ["D", "clarifies"]])("writes %s out as %s without changing its prose, name, handle or spacing", (mark, symbol) => {
      const source = `- [C @claim] Claim.\n  - [ ${mark} @point   ; @step ] Reason [G] stays prose.\n    - [O/] Review this particular step.\n    - [note] Qualification.\n      - [G +> @missing] Inert syntax.`;
      const preview = ready(previewTargetForm(source, { line: 2, form: "named" }));
      expect(preview.proposedSource).toBe(source.replace(`${mark} @point   ;`, `${mark} @point ${symbol} @claim   ;`));
      expect(preview.consequence).toContain(`The relation is now written as ${symbol}; changing the mark will no longer change it.`);
      const before = explainSource(source).graphs[0], after = explainSource(preview.proposedSource).graphs[0];
      expect(formatGraph(after)).toBe(formatGraph(before));
      expect(after.bearings[0]).toMatchObject({ handle: "step", derivedBy: "operator" });
      expect(after.bearings[1].target).toEqual({ kind: "bearing", key: after.bearings[0].key });
    });

    it("preserves forward reuse, the shared declaration and occurrence prose", () => {
      const source = "- [C @claim] Claim.\n  - [G use @shared; @route] Local qualification.\n- [. @shared] Shared content.\n- [C @other] Another claim.\n  - [G use @shared; @second] Other context.";
      const preview = ready(previewTargetForm(source, { line: 2, form: "named" }));
      expect(preview.proposedSource).toContain("[G use @shared +> @claim; @route] Local qualification.");
      const graph = explainSource(preview.proposedSource).graphs[0];
      expect(graph.points).toHaveLength(3);
      expect(graph.bearings[0].sources).toEqual(graph.bearings[1].sources);
      expect(graph.bearings[0].target).not.toEqual(graph.bearings[1].target);
    });

    it.each([["Q", "R", "respondsTo"], ["O", "R", "respondsTo"], ["C", "D", "clarifies"]])(
      "names implicit %s > %s with %s while keeping child and object-note ownership", (parent, child, kind) => {
        for (const occurrence of [`${child} @point`, `${child} use @shared`]) {
          const source = `- [. @shared] Shared content.
- [${parent} @target] Target.
  - Context for the reader.
    - [${occurrence}; @step] Local prose
      with a continuation.
      - [G @reason] A reason for the Point.
      - [O/ @review] Review this attachment.
      - [. note] Point note.
      - [_ note] Bearing note.`;
          const preview = ready(previewTargetForm(source, { line: 5, form: "named" }));
          expect(preview.proposedSource).toBe(source.replace(`[${occurrence};`, `[${occurrence} ${kind} @target;`));
          // Naming the target makes this occurrence's through-body advice obsolete, and only that.
          expect(preview.proposedDiagnostics).toEqual(preview.diagnostics.filter(d => d.code !== "IMPLICIT_ATTACHMENT_THROUGH_BODY"));
          const before = explainSource(source).graphs[0], after = explainSource(preview.proposedSource).graphs[0];
          expect(formatGraph({ ...after, diagnostics: [] })).toBe(formatGraph({ ...before, diagnostics: [] }));
          expect(after.notes).toEqual(before.notes);
          expect(after.bearings[0]).toMatchObject({ kind, handle: "step", derivedBy: "operator" });
          expect(previewTargetForm(preview.proposedSource, { line: 4, form: "named" })).toMatchObject({ reason: "already-named" });
        }
      }
    );

    it("names the canonical Point selected by a reused parent, not a nearby declaration", () => {
      const source = "- [C @first] First.\n- [C @second] Second.\n- [C use @first] Local reading.\n  - Body\n    - [O] Concern.";
      const preview = ready(previewTargetForm(source, { line: 5, form: "named" }));
      expect(preview.edit.insert).toBe(" -> @first");
      expect(preview.diagnostics.map(d => d.code)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
      expect(preview.proposedDiagnostics).toEqual([]);
    });

    it("preserves UTF-16 offsets, CRLF, unusual spacing and no final newline", () => {
      const source = "- [C @claim] 🌧️ Claim.\r\n\r\n  -     [G\t ] Reason.  ";
      const preview = ready(previewTargetForm(source, { line: 3, form: "named" }));
      expect(preview.proposedSource).toBe(source.replace("[G\t ]", "[G +> @claim\t ]"));
      expect(preview.edit.offset).toBe(source.indexOf("[G") + 2);
    });

    it("edits only the selected host fence with the original host columns and namespace", () => {
      const source = "Host 🌧️ @claim\r\n\r\n  ```cog\r\n  - [C @claim] First unit.\r\n    - [G] First reason.\r\n  ```\r\n\r\n```cogitatum\r\n- [C @claim] Second unit.\r\n  - [O] Second reason.\r\n```\r\nTrailing prose.";
      const preview = ready(previewTargetForm(source, { line: 5, mode: "host", form: "named" }));
      expect(preview.proposedSource).toBe(source.replace("[G]", "[G +> @claim]"));
      const first = explainSource(source, "host"), second = explainSource(preview.proposedSource, "host");
      expect(second.graphs[1]).toEqual(first.graphs[1]);
    });

    it("retains unrelated diagnostics and removes only the selected through-body advice", () => {
      const source = "- [. @alone] Isolated material.\n- [C @a] Claim.\n  - Group\n    - [G] One.\n    - [O] Two.";
      const preview = ready(previewTargetForm(source, { line: 4, form: "named" }));
      expect(preview.diagnostics).toHaveLength(2);
      expect(preview.proposedDiagnostics.map(d => [d.code, d.sourceSpan?.startLine])).toEqual([["IMPLICIT_ATTACHMENT_THROUGH_BODY", 5]]);
    });

    it("makes the intended difference when the occurrence later moves", () => {
      const source = "- [C @first] First.\n  - [G; @route] Reason.\n- [C @second] Second.";
      const preview = ready(previewTargetForm(source, { line: 2, form: "named" }));
      const move = (s: string) => { const [first, reason, second] = s.split("\n"); return [first, second, reason].join("\n"); };
      const positional = explainSource(move(source)).graphs[0];
      const named = explainSource(move(preview.proposedSource)).graphs[0];
      expect(positional.points.find(p => p.key === positional.bearings[0].target.key)?.id).toBe("second");
      expect(named.points.find(p => p.key === named.bearings[0].target.key)?.id).toBe("first");
    });

    it("points a constructor source to its constructor, keeping errors, clauses and literals ahead of that advice", () => {
      const source = "- [C @claim] Claim.\n  - [_ +> ^; @joint] Joint route.\n    - [. @first] Source.\n    - [G +> @claim] Independent support.\n    - [O/] Review joint.\n    - [note] Literal.\n      - [G] Inert.";
      expect(previewTargetForm(source, { line: 3, form: "named" })).toMatchObject({ reason: "no-bearing", message: expect.stringContaining("select the constructor") });
      expect(previewTargetForm(source + "\n- [G +> @missing] Broken.", { line: 3, form: "named" })).toMatchObject({ reason: "source-errors" });
      expect(previewTargetForm(source, { line: 4, form: "named" })).toMatchObject({ reason: "already-named" });
      expect(ready(previewTargetForm(source, { line: 5, form: "named" })).proposedSource).toContain("[O -> @joint] Review joint.");
      for (const line of [6, 7]) {
        const preview = previewTargetForm(source, { line, form: "named" });
        expect(preview).toMatchObject({ reason: "no-bearing" });
        if (preview.status === "unavailable") expect(preview.message).not.toContain("select the constructor");
      }
    });

    it("withholds edits when another host unit has errors", () => {
      for (const ending of ["```cog\n- [G +> @missing] Bad.\n```", "```cog\n- [C] Unclosed."]) {
        const source = "```cog\n- [C @c] Claim.\n  - [G] Reason.\n```\n" + ending;
        expect(previewTargetForm(source, { line: 3, mode: "host", form: "named" })).toMatchObject({ status: "unavailable", reason: "source-errors" });
      }
      expect(previewTargetForm("- [C @c] Markdown prose.", { line: 1, mode: "host", form: "named" })).toMatchObject({ status: "unavailable", reason: "no-bearing" });
    });
  });
});
