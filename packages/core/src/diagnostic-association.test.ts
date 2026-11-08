import { describe, expect, it } from "vitest";
import { compileGraph, compileGraphWithExplain, parseDocument } from "./index.js";
import type { Diagnostic, SourceSpan } from "./types.js";

const span = (startLine: number, endLine = startLine): SourceSpan => ({
  startLine, endLine, startColumn: 1, endColumn: 20
});
const diagnostic = (code: string, sourceSpan?: SourceSpan): Diagnostic => ({
  severity: "warning", code, message: code, ...(sourceSpan ? { sourceSpan } : {})
});

describe("Explain diagnostic association", () => {
  it("keeps diagnostic order and unique codes across unsorted, overlapping and sparse spans", () => {
    const ast = parseDocument("- First\n- Second\n- Third\n- Fourth");
    ast.blocks.forEach((block, index) => {
      block.sourceSpan = [span(90, 120), span(2, 6), span(4), span(1_000_000_000)][index];
    });
    ast.diagnostics = [
      diagnostic("last", span(100, 200)),
      diagnostic("shared", span(4, 100)),
      diagnostic("first", span(1, 4)),
      diagnostic("shared", span(3, 5)),
      diagnostic("unplaced"),
      diagnostic("distant", span(1_000_000_000)),
      diagnostic("columns", { ...span(4), startColumn: 50, endColumn: 60 })
    ];
    const result = compileGraphWithExplain(ast);
    expect(result.explain.entries.map(entry => entry.diagnosticCodes)).toEqual([
      ["last", "shared"],
      ["shared", "first", "columns"],
      ["shared", "first", "columns"],
      ["distant"]
    ]);
    expect(result.graph.diagnostics).toEqual(ast.diagnostics);
  });

  it("preserves the visibility of suggestions emitted during Explain construction", () => {
    const ast = parseDocument("- [C @claim] Claim\n  - Body\n    - [G] Reason\n- After");
    ast.blocks[0].sourceSpan = span(1, 4);
    ast.blocks[0].children[0].sourceSpan = span(2, 4);
    ast.blocks[1].sourceSpan = span(3, 4);
    ast.diagnostics = [diagnostic("initial", span(1, 4))];
    const result = compileGraphWithExplain(ast);
    expect(result.explain.entries.map(entry => entry.diagnosticCodes)).toEqual([
      ["initial"], ["initial"],
      ["initial", "IMPLICIT_ATTACHMENT_THROUGH_BODY"],
      ["initial", "IMPLICIT_ATTACHMENT_THROUGH_BODY"]
    ]);
    expect(result.graph.diagnostics.map(item => item.code)).toEqual(["initial", "IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
  });

  it("matches inclusive line overlap for varied caller-supplied AST spans", () => {
    const ast = parseDocument(Array.from({ length: 128 }, (_, index) => `- Body ${index}`).join("\n"));
    ast.blocks.forEach((block, index) => {
      const start = (index * 37) % 163;
      block.sourceSpan = span(start + 1, start + 1 + index % 19);
    });
    ast.diagnostics = Array.from({ length: 193 }, (_, index) => {
      const start = (index * 71) % 179;
      return diagnostic(`code-${index % 17}`, index % 13 ? span(start + 1, start + 1 + index % 23) : undefined);
    });
    const result = compileGraphWithExplain(ast);
    for (const entry of result.explain.entries) {
      const expected = ast.diagnostics.filter(item => item.sourceSpan
        && item.sourceSpan.startLine <= entry.sourceSpan.endLine
        && item.sourceSpan.endLine >= entry.sourceSpan.startLine).map(item => item.code);
      expect(entry.diagnosticCodes).toEqual([...new Set(expected)]);
    }
  });

  it("does not reread every diagnostic span for every block", () => {
    const count = 512;
    const ast = parseDocument(Array.from({ length: count }, (_, index) => `- Body ${index}`).join("\n"));
    let reads = 0;
    ast.diagnostics = ast.blocks.map(block => ({
      severity: "warning", code: "local", message: "Local diagnostic",
      get sourceSpan() { reads++; return block.sourceSpan; }
    }));
    const result = compileGraphWithExplain(ast);
    expect(result.explain.entries).toHaveLength(count);
    expect(result.explain.entries.every(entry => entry.diagnosticCodes.join() === "local")).toBe(true);
    expect(reads).toBeLessThan(count * 8);
  });

  it("compiles Graph diagnostics without inspecting their positions for unused Explain entries", () => {
    const ast = parseDocument("- Body");
    let reads = 0;
    ast.diagnostics = [{
      severity: "warning", code: "local", message: "Local diagnostic",
      get sourceSpan() { reads++; return span(1); }
    }];
    const graph = compileGraph(ast);
    expect(graph.diagnostics).toHaveLength(1);
    expect(reads).toBe(0);
    expect(graph).toEqual(compileGraphWithExplain(ast).graph);
  });
});
