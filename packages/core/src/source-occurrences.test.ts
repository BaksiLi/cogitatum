import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainSource } from "./index.js";
import type { AstBlock, ExplainEffect, SourceParseMode } from "./types.js";

type Attachment = Extract<ExplainEffect, { kind: "implicitAttachment" }>;
const selections = (source: string) => explainSource(source).explanations[0].entries.flatMap(entry =>
  entry.effects.filter((effect): effect is Attachment => effect.kind === "implicitAttachment")
    .map(effect => ({ line: entry.sourceSpan.startLine, ...effect })));

describe("source occurrence evidence", () => {
  it.each([["C", "G"], ["C", "O"], ["C", "?"], ["C", "D"], ["Q", "C"], ["O", "R"]])(
    "records direct %s > %s attachment without advisory noise", (parent, child) => {
      const source = `- [${parent}] Parent.\n  - [${child}] Child.`;
      const result = explainSource(source);
      expect(result.diagnostics).toEqual([]);
      const [selected] = selections(source);
      expect(selected).toMatchObject({ line: 2, contextSpan: { startLine: 1 }, crossedBodySpans: [] });
      expect(selected.target).toEqual(result.graphs[0].bearings[0].target);
    });

  it("identifies a local Point use independently of the canonical declaration", () => {
    const source = "- [C @p] Original.\n- [C @c] Claim.\n  - [G use @p] Here.\n    - [O] Local concern.\n    - [O -> @p] Explicit concern.";
    expect(selections(source)).toMatchObject([
      { line: 3, targetSpan: { startLine: 2 }, contextSpan: { startLine: 2 }, crossedBodySpans: [] },
      { line: 4, targetSpan: { startLine: 1 }, contextSpan: { startLine: 3 }, crossedBodySpans: [] }
    ]);
  });

  it("records Linked targets and local selectors through Bearing uses", () => {
    const source = "- [C @p] Original.\n- [. use @p] Here.\n  - [linked; @b]\n    - [G] First.\n    - [O/] Concern.\n- [_ use @b] Elsewhere.\n  - [O/] Another concern.";
    expect(explainSource(source).diagnostics).toEqual([]);
    expect(selections(source)).toMatchObject([
      { line: 3, target: { kind: "point" }, targetSpan: { startLine: 1 }, contextSpan: { startLine: 2 } },
      { line: 5, target: { kind: "bearing" }, targetSpan: { startLine: 3 }, contextSpan: { startLine: 3 } },
      { line: 7, target: { kind: "bearing" }, targetSpan: { startLine: 3 }, contextSpan: { startLine: 6 } }
    ]);
    expect(selections(source).every(effect => effect.crossedBodySpans.length === 0)).toBe(true);
  });

  it("withholds selected context when validation rejects the structural Bearing", () => {
    const source = "- [C @duplicate] One.\n  - [G] Ground.\n- [C @duplicate] Two.\n- [_ use @missing]\n  - [O/] Unresolved.";
    expect(explainSource(source).diagnostics.some(d => d.severity === "error")).toBe(true);
    expect(selections(source)).toEqual([]);
  });
});

const fixtureRoot = new URL("../../../fixtures/", import.meta.url);
const manifest: { fixtures: { file: string; input: SourceParseMode }[] } =
  JSON.parse(readFileSync(new URL("manifest.json", fixtureRoot), "utf8"));

describe("AST / Explain occurrence contract over the conformance corpus", () => {
  it.each(manifest.fixtures)("$file", ({ file, input }) => {
    const result = explainSource(readFileSync(new URL(file, fixtureRoot), "utf8"), input);
    result.units.forEach((_unit, i) => {
      const blocks: AstBlock[] = [];
      const visit = (block: AstBlock) => {
        blocks.push(block);
        if (block.annotation?.kind !== "note") block.children.forEach(visit);
      };
      result.documents[i].blocks.forEach(visit);
      const entries = result.explanations[i].entries;
      expect(entries.map(entry => entry.sourceSpan)).toEqual(blocks.map(block => block.sourceSpan));
      expect(new Set(entries.map(entry => JSON.stringify(entry.sourceSpan))).size).toBe(entries.length);
      for (const entry of entries) {
        expect(entry.sourceSpan.endLine).toBe(entry.sourceSpan.startLine);
        const emitted = entry.effects.find(effect => effect.kind === "emitBearing");
        const selected = entry.effects.filter((effect): effect is Attachment => effect.kind === "implicitAttachment");
        expect(selected).toHaveLength(emitted?.bearing.derivedBy === "structural" ? 1 : 0);
        for (const selection of selected) {
          expect(selection.target).toEqual(emitted!.bearing.target);
          expect(blocks.some(block => JSON.stringify(block.sourceSpan) === JSON.stringify(selection.contextSpan))).toBe(true);
        }
      }
    });
  });
});
