import { describe, expect, it } from "vitest";
import { analyzeSourceReferences, explainSource, parseDocument, previewExplicitTarget } from "./index.js";

const errors = (source: string) => explainSource(source).diagnostics.filter(d => d.severity === "error").map(d => d.code);

describe("contiguous multiline block content", () => {
  it("keeps the complete Point content shared while use prose and child body stay local", () => {
    const source = [
      "- [C @p] The method may work",
      "  under room-temperature conditions.",
      "",
      "  This is still the same Point.",
      "  - Background at this source occurrence.",
      "- [C @q] Check the method.",
      "  - [G use @p; @route] Reused here",
      "    for this particular check.",
      "    - [_ note] The reason for this route",
      "      continues without another Point."
    ].join("\r\n");
    const result = explainSource(source), graph = result.graphs[0];
    expect(result.diagnostics).toEqual([]);
    expect(graph.points.map(p => p.text)).toEqual([
      "The method may work\nunder room-temperature conditions.\n\nThis is still the same Point.",
      "Check the method."
    ]);
    expect(graph.bearings).toHaveLength(1);
    expect(graph.notes).toHaveLength(1);
    const point = result.documents[0].blocks[0];
    expect(point.raw).toBe(source.split("\r\n").slice(0, 4).join("\n"));
    expect(point.sourceSpan).toEqual({ startLine: 1, startColumn: 3, endLine: 4, endColumn: 32 });
    expect(point.children[0].text).toBe("Background at this source occurrence.");
    expect(result.documents[0].blocks[1].children[0].text).toBe("Reused here\nfor this particular check.");
    expect(graph.notes[0].sourceSpan).toMatchObject({ startLine: 9, endLine: 10 });
    expect(result.explanations[0].entries.map(e => [e.sourceSpan.startLine, e.sourceSpan.endLine])).toEqual([
      [1, 4], [5, 5], [6, 6], [7, 8], [9, 10]
    ]);
  });

  it("keeps annotation-looking continuations as prose, even outside a literal note", () => {
    const source = "- [C @p] Content.\n  [G @hidden] This is prose.\n  - [G @active] A real child.";
    const result = explainSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0].points.map(p => p.id)).toEqual(["p", "active"]);
    expect(result.graphs[0].points[0].text).toBe("Content.\n[G @hidden] This is prose.");
    expect(result.graphs[0].bearings).toHaveLength(1);
    const references = analyzeSourceReferences(source);
    expect(JSON.stringify(references)).not.toContain('"hidden"');
  });

  it.each(["note", ". note", "_ note", "point note", "bearing note"])(
    "preserves multiple paragraphs and literal child continuations beneath [%s]", header => {
      const source = [
        "- [C @p] Claim.",
        "  - [G; @r] Ground.",
        `    - [${header}] First paragraph.`,
        "      Second line.",
        "",
        "      Another paragraph.",
        "      - [O @hidden] Literal child.",
        "        Its own continuation.",
        "    - [O/] Active objection."
      ].join("\n");
      const result = explainSource(source);
      expect(result.diagnostics).toEqual([]);
      const note = result.documents[0].blocks[0].children[0].children[0];
      expect(note.text).toBe("First paragraph.\nSecond line.\n\nAnother paragraph.");
      expect(note.children[0].text).toBe("[O @hidden] Literal child.\nIts own continuation.");
      expect(note.children[0].annotation).toBeUndefined();
      expect(result.graphs[0].points.map(p => p.text)).toEqual(["Claim.", "Ground.", "Active objection."]);
      expect(result.graphs[0].bearings).toHaveLength(2);
      expect(result.graphs[0].notes).toHaveLength(header === "note" ? 0 : 1);
    }
  );

  it("gives linked and explicit constructors complete descriptions without adding sources", () => {
    const source = [
      "- [C @q] Claim.",
      "  - [linked; @joint] These reasons",
      "    are offered together.",
      "    - [G @a] A.",
      "    - [G @b] B.",
      "- [edge @a, @b +> @q; @explicit] The same sources",
      "  in another authored route.",
      "  - [_ note] Explanation",
      "    of that route."
    ].join("\n");
    const result = explainSource(source), graph = result.graphs[0];
    expect(result.diagnostics).toEqual([]);
    expect(graph.points).toHaveLength(3);
    expect(graph.bearings.map(b => b.text)).toEqual([
      "These reasons\nare offered together.",
      "The same sources\nin another authored route."
    ]);
    expect(graph.bearings.map(b => b.sources.length)).toEqual([2, 2]);
    expect(graph.notes.map(n => [n.origin, n.sourceSpan.startLine, n.sourceSpan.endLine])).toEqual([
      ["constructor-description", 2, 3], ["constructor-description", 6, 7], ["note", 8, 9]
    ]);
  });

  it("lets ordinary multiline body remain transparent to active descendants", () => {
    const source = "- [C @q] Claim.\n  - Context\n    continued here.\n    - [G] Reason.";
    const result = explainSource(source);
    expect(errors(source)).toEqual([]);
    expect(result.graphs[0].bearings).toHaveLength(1);
    expect(result.explanations[0].entries[2].effects).toContainEqual(expect.objectContaining({
      kind: "implicitAttachment", crossedBodySpans: [
        expect.objectContaining({ startLine: 2, endLine: 3 })
      ]
    }));
  });

  it.each(["", " ", "\t"])("requires the owning block's continuation prefix: %j", indent => {
    const source = `- [C] Claim.\n${indent}Continued?\n  - [G] Still a child.`;
    expect(errors(source)).toEqual(["UNSUPPORTED_LINE"]);
    expect(explainSource(source).graphs[0].points[0].text).toBe("Claim.");
  });

  it("does not attach a continuation to a distant ancestor or across an unsupported line", () => {
    const source = "- [C] Claim.\n  - [G] Ground.\n  Reopened parent?\n    Cannot skip the rejected line.\n- [C] Next.";
    const result = explainSource(source);
    expect(errors(source)).toEqual(["UNSUPPORTED_LINE", "UNSUPPORTED_LINE"]);
    expect(result.graphs[0].points.map(p => p.text)).toEqual(["Claim.", "Ground.", "Next."]);
  });

  it("measures continuation indentation at the bullet content column and retains extra spaces", () => {
    const source = "-   [C] Claim.\n    Continued.\n      Extra indentation.\n   Too little.";
    const result = explainSource(source);
    expect(errors(source)).toEqual(["UNSUPPORTED_LINE"]);
    expect(result.graphs[0].points[0].text).toBe("Claim.\nContinued.\n  Extra indentation.");
  });

  it.each(["point use @missing", "bearing @p +> @q", "linked"])(
    "does not close a broken [%s header using continuation prose", header => {
      const source = `- [C @q] Claim.\n  - [${header}\n    ] Prose, not a repaired header.\n    - [G] Child.`;
      const result = explainSource(source), failed = result.documents[0].blocks[0].children[0];
      expect(result.diagnostics.some(d => d.code === "MALFORMED_ANNOTATION_PREFIX")).toBe(true);
      expect(failed.annotation?.raw).toBe(header);
      expect(result.graphs[0].bearings).toHaveLength(0);
    }
  );

  it("keeps an unclosed multiline note literal and does not leak later declarations", () => {
    const source = "- [C] Claim.\n  - [_ note\n    ] Not a closing header.\n    - [G @hidden] Literal.\n      Continuation.\n  - [G @active] Active.";
    const result = explainSource(source);
    expect(errors(source)).toEqual(["MALFORMED_NOTE"]);
    expect(result.graphs[0].points.map(p => p.id)).toEqual([undefined, "active"]);
  });

  it("retains blank lines only inside continued content, without swallowing a following sibling", () => {
    const source = "- [C] First.\n \n  Continued.\n\n- [C] Next.\n\n";
    const result = explainSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.documents[0].blocks.map(b => b.text)).toEqual(["First.\n\nContinued.", "Next."]);
    expect(result.documents[0].blocks[0].raw).toBe("- [C] First.\n \n  Continued.");
    expect(result.documents[0].blocks[1].sourceSpan).toMatchObject({ startLine: 5, endLine: 5 });
  });

  it.each(["\n", "\r\n", "\r"])("maps multiline host content and an edit from a continuation under %j endings", ending => {
    const lines = [
      "Host.",
      "  ```cog",
      "  - [C @q] Claim.",
      "    - [G; @r] Ground.",
      "      More ground.",
      "      - [_ note] Note.",
      "        More note.",
      "  ```"
    ];
    const source = lines.join(ending), result = explainSource(source, "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0].points[1]).toMatchObject({
      text: "Ground.\nMore ground.",
      sourceSpan: { startLine: 4, startColumn: 7, endLine: 5, endColumn: lines[4].length + 1 }
    });
    const preview = previewExplicitTarget(source, { mode: "host", line: 5 });
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(preview.proposedSource).toBe(source.replace("[G; @r]", "[G +> @q; @r]"));
    expect(explainSource(preview.proposedSource, "host").graphs[0].notes).toEqual(result.graphs[0].notes);
    expect(previewExplicitTarget(source, { mode: "host", line: 7 }).status).toBe("unavailable");
  });

  it("uses per-line source offsets for a multiline span and checks mapping overflow", () => {
    const source = "- [C] First.\n  Last.";
    const ast = parseDocument(source, { lineOffset: 5, lineColumnOffsets: [2, 4] });
    expect(ast.blocks[0].sourceSpan).toEqual({ startLine: 6, startColumn: 5, endLine: 7, endColumn: 12 });
    expect(() => parseDocument(source, { lineColumnOffsets: [0, Number.MAX_SAFE_INTEGER] })).toThrow(RangeError);
  });

  it.each(["\t", "  ", "    "])("preserves note ownership and reuse with %j bullet indentation", indent => {
    const source = [
      "- [C @q] Claim.",
      "  A qualification before any indented bullet.",
      `${indent}- [G @p; @r] Ground.`,
      `${indent}  Continued ground.`,
      `${indent.repeat(2)}- [_ note] Route note.`,
      `${indent.repeat(2)}  Continued note.`,
      "",
      `${indent.repeat(2)}  Another paragraph.`,
      `${indent.repeat(3)}- [O @hidden] Literal child.`,
      `${indent.repeat(3)}  Continued literal.`,
      `${indent.repeat(2)}- [O/] Active challenge.`,
      "- [. use @p] Local reuse.",
      "  Continued local prose.",
      "- [_ use @r]",
      `${indent}- [_ note] A second note.`,
      `${indent}  At the reused route.`
    ].join("\n");
    const result = explainSource(source), graph = result.graphs[0];
    expect(result.diagnostics).toEqual([]);
    expect(graph.points.map(point => point.text)).toEqual([
      "Claim.\nA qualification before any indented bullet.",
      "Ground.\nContinued ground.",
      "Active challenge."
    ]);
    expect(graph.bearings).toHaveLength(2);
    expect(graph.bearings[1].target).toEqual({ kind: "bearing", key: graph.bearings[0].key });
    expect(graph.notes.map(note => [note.target.key, note.sourceSpan.startLine, note.sourceSpan.endLine])).toEqual([
      [graph.bearings[0].key, 5, 8], [graph.bearings[0].key, 15, 16]
    ]);
    const note = result.documents[0].blocks[0].children[0].children[0];
    expect(note.text).toBe("Route note.\nContinued note.\n\nAnother paragraph.");
    expect(note.children[0].text).toBe("[O @hidden] Literal child.\nContinued literal.");
    expect(note.children[0].annotation).toBeUndefined();
    expect(result.documents[0].blocks[1].text).toBe("Local reuse.\nContinued local prose.");
    expect(previewExplicitTarget(source, { line: 4 })).toMatchObject({
      status: "ready", proposedSource: source.replace("[G @p; @r]", "[G @p +> @q; @r]")
    });
  });

  it("rejects a wrong continuation prefix without changing the tab-indented outline", () => {
    const source = "- [C] Claim.\n\t- [G] Ground.\n    Spaces cannot replace the tab.\n\t- [O] Objection.";
    const result = explainSource(source);
    expect(errors(source)).toEqual(["UNSUPPORTED_LINE"]);
    expect(result.graphs[0].points.map(point => point.text)).toEqual(["Claim.", "Ground.", "Objection."]);
    expect(result.graphs[0].bearings).toHaveLength(2);
  });

  it("does not mistake a mixed-indentation bullet for a continuation or activate its note subtree", () => {
    const source = "- [C] Claim.\n\t- [G] Ground.\n\t  - [_ note] Mixed bullet indentation.\n\t\t\t\t- [G @hidden] Literal.";
    const result = explainSource(source);
    expect(errors(source)).toEqual(["MIXED_INDENTATION", "MALFORMED_NOTE"]);
    expect(result.graphs[0].points.map(point => point.text)).toEqual(["Claim.", "Ground."]);
    expect(result.graphs[0].notes).toEqual([]);
    expect(result.documents[0].blocks[0].children[0].children[0].children[0].annotation).toBeUndefined();
  });

  it("keeps extra whitespace after the continuation prefix as prose rather than bullet indentation", () => {
    const source = "- [C] Claim.\n  \tIndented prose.\n\t- [G] Ground.";
    const result = explainSource(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs[0].points[0].text).toBe("Claim.\n\tIndented prose.");
  });

  it.each(["\n", "\r\n", "\r"])("maps tab continuations through host margins with %j endings", ending => {
    const source = [
      "  ```cog",
      "  - [C @q] Claim.",
      "  \t- [G; @r] Ground.",
      "  \t  Continued.",
      "  \t\t- [_ note] Note.",
      "  \t\t  Continued note.",
      "  ```",
      "```cog",
      "- [C] Other unit.",
      "  - [G] Independent space indentation.",
      "```"
    ].join(ending);
    const result = explainSource(source, "host");
    expect(result.diagnostics).toEqual([]);
    expect(result.graphs).toHaveLength(2);
    expect(result.graphs[0].points[1].sourceSpan).toEqual({
      startLine: 3, startColumn: 6, endLine: 4, endColumn: 16
    });
    expect(result.graphs[0].notes[0].sourceSpan).toEqual({
      startLine: 5, startColumn: 7, endLine: 6, endColumn: 22
    });
    expect(previewExplicitTarget(source, { mode: "host", line: 4 })).toMatchObject({
      status: "ready", proposedSource: source.replace("[G; @r]", "[G +> @q; @r]")
    });
  });
});
