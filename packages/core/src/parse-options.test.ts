import { describe, expect, it } from "vitest";
import { compileGraphWithExplain, parseDocument } from "./index.js";

const source = "- [C @claim] 🌧️ Claim.\n  - [G] Reason.";

describe("public parser source mappings", () => {
  it("applies valid offsets to declarations, relations and Explain entries", () => {
    const ast = parseDocument(source, { lineOffset: 4, lineColumnOffsets: [2, 3] });
    const { graph, explain } = compileGraphWithExplain(ast);
    const lines = source.split("\n");
    const rootSpan = { startLine: 5, endLine: 5, startColumn: 5, endColumn: lines[0].length + 3 };
    const childSpan = { startLine: 6, endLine: 6, startColumn: 8, endColumn: lines[1].length + 4 };
    expect(ast.blocks[0].sourceSpan).toEqual(rootSpan);
    expect(ast.blocks[0].children[0].sourceSpan).toEqual(childSpan);
    expect(graph.points.map(point => point.sourceSpan)).toEqual([rootSpan, childSpan]);
    expect(graph.bearings[0].sourceSpan).toEqual(childSpan);
    expect(explain.entries.map(entry => entry.sourceSpan)).toEqual([rootSpan, childSpan]);
    expect(graph.diagnostics).toEqual([]);
    expect(ast.blocks[0].raw).toBe(lines[0]);
  });

  it("defaults missing per-line column offsets to zero", () => {
    const defaults = parseDocument(source);
    for (const offsets of [[], [0], new Array<number>(2)]) {
      expect(parseDocument(source, { lineColumnOffsets: offsets })).toEqual(defaults);
    }
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid line offset %s before producing an AST",
    lineOffset => expect(() => parseDocument(source, { lineOffset })).toThrow(/lineOffset.*nonnegative safe integer/)
  );

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid column offset %s before producing an AST",
    offset => expect(() => parseDocument(source, { lineColumnOffsets: [0, offset] })).toThrow(/lineColumnOffsets.*nonnegative safe integers/)
  );

  it("rejects mapping overflow for supported and diagnosed lines", () => {
    for (const input of [source, "Unsupported prose."]) {
      expect(() => parseDocument(input, { lineOffset: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
      expect(() => parseDocument(input, { lineColumnOffsets: [Number.MAX_SAFE_INTEGER] })).toThrow(RangeError);
    }
  });

  it("accepts the largest exact coordinates without rounding", () => {
    const line = "- [C] Claim.";
    const ast = parseDocument(line, {
      lineOffset: Number.MAX_SAFE_INTEGER - 1,
      lineColumnOffsets: [Number.MAX_SAFE_INTEGER - line.length - 1]
    });
    expect(ast.blocks[0].sourceSpan).toEqual({
      startLine: Number.MAX_SAFE_INTEGER,
      endLine: Number.MAX_SAFE_INTEGER,
      startColumn: Number.MAX_SAFE_INTEGER - line.length + 2,
      endColumn: Number.MAX_SAFE_INTEGER
    });
  });
});
