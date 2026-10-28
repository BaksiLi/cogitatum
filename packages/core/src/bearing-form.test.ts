import { describe, expect, it, vi } from "vitest";
import { explainSource, previewBearingForm } from "./index.js";
import type { BearingFormPreview } from "./index.js";
import * as sourceModule from "./source.js";

function ready(result: BearingFormPreview) {
  expect(result.status, JSON.stringify(result)).toBe("ready");
  if (result.status !== "ready") throw new Error(result.message);
  let source = result.originalSource;
  for (const edit of [...result.edits].reverse()) {
    expect(result.originalSource.slice(edit.offset, edit.offset + edit.remove.length)).toBe(edit.remove);
    source = source.slice(0, edit.offset) + edit.insert + source.slice(edit.offset + edit.remove.length);
  }
  expect(source).toBe(result.proposedSource);
  expect(result.proposedDiagnostics.some(d => d.severity === "error")).toBe(false);
  return result;
}

describe("structurally equivalent Bearing previews", () => {
  it.each(["G", "O", "R", "D", "G/", "O/", "Q/"])("round-trips a %s Point attachment, retaining note ownership and descendants", mark => {
    const source = `- [. @shared] Shared content.
- [C @claim] Claim.
  - [G @reason; @step] Reason.
    - Context.
      - [${mark} use @shared; @review] Local prose
        continued here.
        - [. note] Point note.
          - [G @hidden] Literal.
        - [_ note] Relation note.
        - [O/] Discuss this relation.
        - [G] Discuss this Point.`;
    const explicit = ready(previewBearingForm(source, { line: 6, form: "explicit" }));
    expect(explicit.proposedSource).toContain(`[${mark.replace("/", "")} use @shared `);
    expect(explicit.proposedSource).toContain("[G @hidden] Literal.");
    const local = ready(previewBearingForm(explicit.proposedSource, { line: 5, form: "local" }));
    expect(local.proposedSource).toBe(source);
    expect(local.consequence).toContain("nearest semantic context");
    expect(explainSource(local.proposedSource).graphs[0].notes).toEqual(explainSource(source).graphs[0].notes);
  });

  it.each(["_", "bearing", "edge"])("preserves ordered %s group sources, anonymous descendants, multiline descriptions and literal notes", family => {
    const source = `- [. @shared] Shared content.
- [C @claim] Claim.
  - [${family} O; @joint] Review together.
    A second line.
    - [. @first] First source.
      - [G] Anonymous reason.
      - [. note] Source note.
    - [. use @shared] Occurrence prose.
    - [_ note] Joint note.
      - [G @hidden] Literal source.
    - [Q/] What scope?
    - [G +> @claim] Independent relation.
- [.] Unrelated anonymous content.`;
    const explicit = ready(previewBearingForm(source, { line: 4, form: "explicit" }));
    expect(explicit.proposedSource).toContain(`[${family} @first, @shared -> @claim; @joint] Review together.\n    A second line.`);
    expect(explicit.proposedSource.indexOf("[. @first]")).toBeLessThan(explicit.proposedSource.indexOf(`[${family} @first,`));
    const headerLine = explicit.proposedSource.split("\n").findIndex(l => l.includes(`[${family} @first,`)) + 1;
    const local = ready(previewBearingForm(explicit.proposedSource, { line: headerLine, form: "local" }));
    expect(local.proposedSource).toContain(`[${family} O; @joint] Review together.\n    A second line.\n    - [. use @first]\n    - [. use @shared]`);
    expect(local.proposedSource).toContain("- [. @first] First source.");
    expect(local.consequence).toContain("not restoration");
    const compiled = explainSource(local.proposedSource);
    expect(compiled.graphs[0].points).toHaveLength(7);
    expect(compiled.graphs[0].notes).toHaveLength(3);
  });

  it.each(["G/", "O/", "Q/"])("moves %s sources outside an enclosing joint without enlarging it", mark => {
    const source = `- [C @claim] Claim.
  - [_ G; @outer]
    - [. @a] Original source.
    - [_ ${mark}; @review] Discuss the outer step.
      - [. @b] First review source.
        - [G] Further reason.
      - [. @c] Second review source.
      - [_ note] Review note.`;
    const explicit = ready(previewBearingForm(source, { line: 4, form: "explicit" }));
    expect(explicit.proposedSource.indexOf("[. @b]")).toBeLessThan(explicit.proposedSource.indexOf("[_ G; @outer]"));
    const graph = explainSource(explicit.proposedSource).graphs[0];
    expect(graph.bearings.find(b => b.handle === "outer")?.sources).toHaveLength(1);
    expect(graph.bearings.find(b => b.handle === "review")?.sources).toHaveLength(2);
    const line = explicit.proposedSource.split("\n").findIndex(l => l.includes("; @review]")) + 1;
    ready(previewBearingForm(explicit.proposedSource, { line, form: "local" }));
  });

  it.each(["\n", "\r\n", "\r", "mixed"])("preserves host source, fences, namespaces and original %j separators", ending => {
    const content = [
      "Host 😀.", "  ```cog", "  - [C @claim] Claim.", "  \t- [G; @step] Reason.",
      "  \t\t- [_ O/; @review] Joint review.", "  \t\t\t- [. @a] First.",
      "  \t\t\t  Continued.", "  \t\t\t- [. @b] Second.", "  \t\t\t  \u2028 stays content.",
      "  ```", "Surrounding prose.", "```cog", "- [C @claim] Other namespace.", "```"
    ];
    const source = content.map((l, i) => l + (i === content.length - 1 ? "" : ending === "mixed" ? ["\n", "\r\n", "\r"][i % 3] : ending)).join("");
    const explicit = ready(previewBearingForm(source, { line: 5, form: "explicit", mode: "host" }));
    const before = explainSource(source, "host"), after = explainSource(explicit.proposedSource, "host");
    expect(after.graphs[1]).toEqual(before.graphs[1]);
    expect(explicit.proposedSource).toContain("Surrounding prose.");
    expect(explicit.proposedSource).toContain("  \t\t  \u2028 stays content.");
    expect(explicit.edits.filter(e => e.remove).every(e => source.includes(e.remove))).toBe(true);
  });

  it.each([false, true])("handles a group at EOF (final newline=%s)", finalNewline => {
    const source = "- [C @c] Claim.\n  - [_ G]\n    - [. @a] A.\n    - [. @b] B." + (finalNewline ? "\n" : "");
    const result = ready(previewBearingForm(source, { line: 2, form: "explicit" }));
    expect(result.proposedSource).toContain("[_ @a, @b +> @c]");
    const explicit = "- [. @a] A.\n- [C @c] Claim.\n  - [_ @a +> @c]" + (finalNewline ? "\n" : "");
    ready(previewBearingForm(explicit, { line: 3, form: "local" }));
  });

  it.each([
    ["anonymous target", "- [C] Claim.\n  - [G] Reason.", 2, "explicit", "unnamed-target"],
    ["anonymous source", "- [C @c] Claim.\n  - [_ G]\n    - [.] Reason.", 2, "explicit", "unnamed-source"],
    ["ordinary Q", "- [C] Claim.\n  - [Q] Why?", 2, "explicit", "no-bearing"],
    ["joint member", "- [C @c] Claim.\n  - [_ G]\n    - [. @a] Reason.", 3, "explicit", "no-bearing"],
    ["literal descendant", "- [C] Claim.\n  - [note] Literal.\n    - [G] Inert.", 3, "explicit", "no-bearing"],
    ["role change", "- [C @c] Claim.\n  - [Q +> @c] Why?", 2, "local", "unsupported-local-form"],
    ["neutral declaration", "- [C @c] Claim.\n  - [. +> @c] Reason.", 2, "local", "unsupported-local-form"],
    ["answers", "- [Q @q] Which scale?\n  - [C answers @q] Seconds.", 2, "local", "unsupported-local-form"],
    ["Point concerns", "- [C @c] Claim.\n  - [Q ~> @c] Which scope?", 2, "local", "unsupported-local-form"],
    ["wrong nearer target", "- [C @a] A.\n- [C @b] B.\n  - [G +> @a] Reason.", 3, "local", "preservation-failed"],
    ["no local target", "- [. @a] A.\n- [C @c] Claim.\n- [_ @a +> @c]", 3, "local", "preservation-failed"],
    ["other errors", "- [C @c] Claim.\n  - [G] Reason.\n- [O -> @missing] Bad.", 2, "explicit", "source-errors"],
    ["already explicit", "- [C @c] Claim.\n  - [G +> @c] Reason.", 2, "explicit", "already-explicit"],
    ["already local", "- [C @c] Claim.\n  - [G] Reason.", 2, "local", "already-local"]
  ] as const)("declines %s with no partial result", (_name, source, line, form, reason) => {
    const result = previewBearingForm(source, { line, form });
    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(result).not.toHaveProperty("edits");
    expect(result).not.toHaveProperty("proposedSource");
  });

  it.each(["text", "source order", "note ownership", "source order in a joint", "provenance", "diagnostic"])("rejects unexpected changes to %s", change => {
    const original = sourceModule.explainSource;
    const spy = vi.spyOn(sourceModule, "explainSource").mockImplementation((source, mode) => {
      const result = original(source, mode);
      if (source.includes("[_ @a, @b +> @c; @joint]")) {
        if (change === "text") result.graphs[0].points[0].text = "Changed.";
        if (change === "source order") result.documents[0].blocks[0].children.reverse();
        if (change === "note ownership") result.graphs[0].notes[0].target = { kind: "point", key: result.graphs[0].points[0].key };
        if (change === "source order in a joint") result.graphs[0].bearings[0].sources.reverse();
        if (change === "provenance") result.graphs[0].bearings[0].derivedBy = "structural";
        if (change === "diagnostic") result.diagnostics.push({ severity: "suggestion", code: "UNEXPECTED", message: "New concern." });
      }
      return result;
    });
    try {
      const result = previewBearingForm("- [C @c] Claim.\n  - [_ G; @joint]\n    - [. @a] A.\n    - [. @b] B.\n    - [_ note] Step note.", { line: 2, form: "explicit" });
      expect(result).toMatchObject({ status: "unavailable", reason: "preservation-failed" });
    } finally { spy.mockRestore(); }
  });
});
