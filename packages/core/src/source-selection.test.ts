import { describe, expect, it } from "vitest";
import { compileSource, explainSource, extractCogitatumSourceUnits, parseSource } from "./index.js";
import type { SourceParseMode } from "./types.js";

const fence = String.fromCharCode(96).repeat(3);
const active = [fence + "cog", "- [C @visible] Visible.", fence].join("\n");

describe("explicit Markdown source selection", () => {
  it.each([
    ["comment", "<!--\n" + active.replace("visible", "hidden") + "\n-->"],
    ["pre", "<pre>\n" + active.replace("visible", "hidden") + "\n</pre>"],
    ["raw HTML", "<div>\n" + active.replace("visible", "hidden") + "\n</div>"],
    ["literal fence", fence + "`text\n" + active.replace("visible", "hidden") + "\n" + fence + "`"],
    ["indented code", active.split("\n").map(line => "    " + line).join("\n")]
  ])("ignores a fence-looking sequence inside %s", (_name, literal) => {
    const empty = explainSource(literal, "host");
    expect(empty.units).toEqual([]);
    expect(empty.documents).toEqual([]);
    expect(empty.graphs).toEqual([]);
    expect(empty.explanations).toEqual([]);
    expect(empty.diagnostics).toEqual([]);
    const mixed = compileSource(literal + "\n\n" + active, "host");
    expect(mixed.graphs).toHaveLength(1);
    expect(mixed.graphs[0].points.map(point => point.id)).toEqual(["visible"]);
    expect(mixed.diagnostics).toEqual([]);
  });

  it.each([
    ["list", "- Item.\n\n" + active.split("\n").map(line => "  " + line).join("\n"), 3, 3],
    ["list with deeper indentation", "- Item.\n\n" + active.split("\n").map(line => "    " + line).join("\n"), 3, 5],
    ["blockquote", active.split("\n").map(line => "> " + line).join("\n"), 1, 3],
    ["inline list opening", "- " + active.replaceAll("\n", "\n  "), 1, 3]
  ])("diagnoses an actual %s fence without importing its namespace", (_name, nested, startLine, startColumn) => {
    const compiled = compileSource(nested + "\n\n" + active, "host");
    expect(compiled.units).toHaveLength(1);
    expect(compiled.graphs[0].points.map(point => point.id)).toEqual(["visible"]);
    expect(compiled.diagnostics).toEqual([expect.objectContaining({
      code: "UNSUPPORTED_NESTED_COGITATUM_FENCE",
      sourceSpan: expect.objectContaining({ startLine, startColumn })
    })]);
  });

  it("does not reinterpret unfenced host text when a fence is added or removed", () => {
    const prose = "# Reader order\n\n- [C @outside] Unselected native-looking material.\n\nExplanation between regions.";
    expect(compileSource(prose, "host").graphs).toEqual([]);
    expect(compileSource(prose, "host").diagnostics).toEqual([]);
    const selected = compileSource(prose + "\n\n" + active, "host");
    expect(selected.graphs[0].points.map(point => point.id)).toEqual(["visible"]);
    expect(selected.documents[0].blocks[0].sourceSpan.startLine).toBe(8);
    expect(selected.diagnostics).toEqual([]);
  });

  it.each(["\n", "\r\n", "\r"])("preserves original UTF-16 columns with line ending %j", lineEnding => {
    const lines = ["Intro 😀.", "  " + fence + "cog", "  - [C @claim] 😀 Conclusion.", "    - [linked; @route] 😀 Route.", "      - [G @premise] 😀 Premise.", "  " + fence];
    const explained = explainSource(lines.join(lineEnding), "host");
    expect(explained.diagnostics).toEqual([]);
    expect(explained.units[0]).toMatchObject({ startLine: 3, endLine: 5 });
    expect(explained.graphs[0].points[0].sourceSpan).toEqual({ startLine: 3, startColumn: 5, endLine: 3, endColumn: lines[2].length + 1 });
    expect(explained.graphs[0].bearings[0].sourceSpan).toEqual({ startLine: 4, startColumn: 7, endLine: 4, endColumn: lines[3].length + 1 });
    expect(explained.explanations[0].entries[1].sourceSpan).toEqual(explained.graphs[0].bearings[0].sourceSpan);
    expect(explained.documents[0].blocks[0].raw).toBe("- [C @claim] 😀 Conclusion.");
    expect(explained.units[0].source.split("\n")).toEqual(lines.slice(2, 5).map(line => line.slice(2)));
  });

  it("keeps namespace isolation and complete units before an unclosed region", () => {
    const source = [active, "Narrative between regions.", fence + "cog\n- [G +> @visible] Cross-unit target.\n" + fence, fence + "cog\n- [C @discarded] Unclosed."].join("\n\n");
    const explained = explainSource(source, "host");
    expect(explained.units).toHaveLength(2);
    expect(explained.documents).toHaveLength(2);
    expect(explained.graphs).toHaveLength(2);
    expect(explained.explanations).toHaveLength(2);
    expect(explained.graphs[0].points[0].id).toBe("visible");
    expect(explained.graphs[1].points).toHaveLength(1);
    expect(explained.graphs[1].bearings).toEqual([]);
    expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["UNCLOSED_COGITATUM_FENCE", "UNKNOWN_TARGET"]);
  });

  it.each([parseSource, compileSource, explainSource, extractCogitatumSourceUnits])("rejects runtime auto context instead of selecting by content", api => {
    expect(() => api(active, "auto" as SourceParseMode)).toThrow("auto selection is retired");
  });

  it("retains constructor failure boundaries inside a selected unit", () => {
    const source = [fence + "cog", "- [C @claim] Conclusion.", "  - [join]", "    - [G] Premise.", "  - [edge]", "    - [G] No explicit target.", fence].join("\n");
    const explained = explainSource(source, "host");
    expect(explained.graphs[0].points).toHaveLength(3);
    expect(explained.graphs[0].bearings).toEqual([]);
    expect(explained.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["RETIRED_JOIN_ANNOTATION", "MALFORMED_EDGE_ANNOTATION", "EDGE_DESCENDANT_REQUIRES_EXPLICIT_TARGET"]);
  });
});
