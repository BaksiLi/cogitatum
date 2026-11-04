import { describe, expect, it, vi } from "vitest";
import { analyzeSourceEdits, explainSource, previewRelationEdit, previewTargetForm } from "./index.js";
import type { SourceEditRequest, SourceParseMode } from "./index.js";
import * as sourceModule from "./source.js";

const previews = [
  {
    name: "relation edits", missingReason: "no-relation", replacement: "[O; @step]",
    preview: (source: string, line: number, mode: SourceParseMode) => previewRelationEdit(source, { operation: "decide", line, kind: "challenges", mode })
  },
  {
    name: "target forms", missingReason: "no-bearing", replacement: "[G +> @c; @step]",
    preview: (source: string, line: number, mode: SourceParseMode) => previewTargetForm(source, { line, form: "named", mode })
  }
];

describe.each(previews)("$name source selection", ({ preview, missingReason, replacement }) => {
  it("selects the owning header from continuation lines, keeping literal note descendants inert", () => {
    const source = "- [C @c] Claim.\n  - [G; @step] Reason.\n    Continued.\n    - [note] Literal.\n      - [G] Inert.";
    const header = preview(source, 2, "document");
    expect(header).toMatchObject({ status: "ready", proposedSource: source.replace("[G; @step]", replacement) });
    expect(preview(source, 3, "document")).toEqual(header);
    for (const line of [4, 5, 100]) {
      expect(preview(source, line, "document")).toMatchObject({ status: "unavailable", reason: missingReason });
    }
  });

  it("edits only the selected host unit even when another unit repeats its names and header", () => {
    const lines = [
      "Prose 😀.", "```cog", "- [C @c] First.", "  - [G; @step] Reason.", "```", "",
      "  ```cogitatum", "  - [C @c] Second.", "    - [G; @step] Reason.", "      Continued.", "  ```", "Tail."
    ];
    const source = lines.join("\r\n");
    const result = preview(source, 10, "host");
    lines[8] = lines[8].replace("[G; @step]", replacement);
    expect(result).toMatchObject({ status: "ready", proposedSource: lines.join("\r\n") });
    expect(result).toEqual(preview(source, 9, "host"));
    expect(preview(source, 1, "host")).toMatchObject({ status: "unavailable", reason: missingReason });
  });

  it("keeps complete-input diagnostics and argument precedence when another host unit is invalid", () => {
    const source = "```cog\n- [C @c] Claim.\n  - [G; @step] Reason.\n```\n```cog\n- [G +> @missing] Broken.\n- [C @duplicate] A.\n- [C @duplicate] B.\n```";
    const diagnostics = explainSource(source, "host").diagnostics;
    expect(diagnostics.length).toBeGreaterThan(1);
    expect(preview(source, 3, "host")).toMatchObject({ status: "unavailable", reason: "source-errors", diagnostics });
    expect(preview(source, 0, "host")).toMatchObject({ status: "unavailable", reason: "invalid-line", diagnostics });
  });
});

describe("shared original analysis for edit previews", () => {
  it("compiles the original once and independently validates every proposed source", () => {
    const source = "- [C @c] Claim.\n  - [G @a] A.\n  - [G @b] B.";
    const compile = vi.spyOn(sourceModule, "explainSource");
    try {
      const analysis = analyzeSourceEdits(source);
      const requests: SourceEditRequest[] = [
        { kind: "target-form", line: 2, form: "named" },
        { kind: "target-form", line: 2, form: "positional" },
        { kind: "relation", edit: { operation: "decide", line: 2, kind: "supports" } },
        { kind: "relation", edit: { operation: "decide", line: 2, kind: "challenges" } },
        { kind: "relation", edit: { operation: "join", lines: [2, 3] } }
      ];
      const results = requests.map(request => analysis.preview(request));
      expect(results.map(result => result.status)).toEqual(["ready", "unavailable", "unavailable", "ready", "ready"]);
      expect(compile.mock.calls.filter(([input]) => input === source)).toHaveLength(1);
      expect(compile.mock.calls.slice(1).map(([input]) => input)).toEqual(results.flatMap(result => result.status === "ready" ? [result.proposedSource] : []));
    } finally {
      compile.mockRestore();
    }
  });

  it("keeps diagnostic spans, commitment targets and sibling arrays isolated from later previews", () => {
    const source = "- [C @c] Claim.\n  - Body.\n    - [G @a] A.\n    - [G @b] B.";
    const analysis = analyzeSourceEdits(source);
    const request: SourceEditRequest = { kind: "relation", edit: { operation: "decide", line: 3, kind: "challenges" } };
    const first = analysis.preview(request), second = analysis.preview(request);
    const expected = structuredClone(first);
    expect(first.status).toBe("ready");
    if (first.status !== "ready" || !("comparison" in first)) throw new Error("Expected a relation edit.");
    expect(first.comparison.retracted[0].target).toMatchObject({ kind: "point" });
    analysis.diagnostics[0].sourceSpan!.startLine = -1;
    first.diagnostics[0].sourceSpan!.startLine = -2;
    first.comparison.retracted[0].target.key = "changed";
    first.comparison.added[0].sources.length = 0;
    analysis.siblingsAt(3).lines.length = 0;
    expect(second).toStrictEqual(expected);
    expect(analysis.preview(request)).toStrictEqual(expected);
    expect(analysis.siblingsAt(3)).toEqual({ lines: [3, 4], index: 0 });
    expect(analysis.preview(request)).toStrictEqual(previewRelationEdit(source, request.edit));
  });

  it("locates continuation lines in their own host unit without exposing literal note descendants", () => {
    const source = "```cog\n- [C @c] First.\n  - [G] A.\n```\n```cog\n- [C @c] Second.\n  - [G] B.\n    Continued.\n  - [note] Literal.\n    - [G] Inert.\n```";
    const analysis = analyzeSourceEdits(source, "host");
    expect(analysis.siblingsAt(8)).toEqual({ lines: [7, 9], index: 0 });
    expect(analysis.siblingsAt(10)).toEqual({ lines: [], index: -1 });
    expect(analysis.siblingsAt(1)).toEqual({ lines: [], index: -1 });
    expect(analysis.preview({ kind: "target-form", line: 8, form: "named" }))
      .toStrictEqual(previewTargetForm(source, { line: 8, form: "named", mode: "host" }));
    const invalid = analyzeSourceEdits(source + "\n```cog\n- [G +> @missing] Broken.\n```", "host");
    expect(invalid.preview({ kind: "target-form", line: 8, form: "named" })).toMatchObject({ status: "unavailable", reason: "source-errors" });
    expect(invalid.preview({ kind: "target-form", line: 0, form: "named" })).toMatchObject({ status: "unavailable", reason: "invalid-line" });
    expect(analysis.preview({ kind: "target-form", line: 8, form: "named" }).status).toBe("ready");
  });
});
