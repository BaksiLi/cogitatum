import { describe, expect, it } from "vitest";
import { explainSource, previewRelationEdit, previewTargetForm } from "./index.js";
import type { SourceParseMode } from "./index.js";

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
