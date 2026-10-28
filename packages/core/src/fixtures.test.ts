import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSource } from "./index.js";
import type { AstBlock, GraphIR, SourceParseMode } from "./types.js";

const fixtureRoot = new URL("../../../fixtures/", import.meta.url);
const manifest: { fixtures: Array<{ file: string; input: SourceParseMode; purpose: string; expected: string; notes?: boolean }> } =
  JSON.parse(readFileSync(new URL("manifest.json", fixtureRoot), "utf8"));

describe("portable language conformance cases", () => {
  it("registers every expectation exactly once", () => {
    const registered = manifest.fixtures.map(({ expected }) => expected);
    const discovered = readdirSync(fixtureRoot, { recursive: true })
      .map((path) => path.replaceAll("\\", "/")).filter((path) => path.endsWith(".expected.json"));
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual(discovered.sort());
  });

  it.each(manifest.fixtures)("$file — $purpose", (entry) => {
    expect(entry.purpose.trim().length).toBeGreaterThan(0);
    expect(entry.expected).toBe(entry.file.replace(/(?:\.cog)?\.md$/, ".expected.json"));
    const source = readFileSync(new URL(entry.file, fixtureRoot), "utf8");
    const expected = JSON.parse(readFileSync(new URL(entry.expected, fixtureRoot), "utf8"));
    const compiled = compileSource(source, entry.input);
    // Generated keys are deliberately absent from this portable expectation.
    // Resolve them through the graph, then compare exact source-local topology.
    const actual = {
      mode: compiled.mode,
      diagnostics: compiled.diagnostics.map(({ code, severity, sourceSpan }) => ({
        line: sourceSpan?.startLine ?? null, code, severity
      })),
      graphs: compiled.graphs.map((graph, index) => projectGraph(graph, entry.notes ? compiled.documents[index].blocks : undefined))
    };
    expect(JSON.parse(JSON.stringify(actual)), fileURLToPath(new URL(entry.expected, fixtureRoot))).toEqual(expected);
  });
});

function projectGraph(graph: GraphIR, blocks?: AstBlock[]) {
  function refLine(kind: "point" | "bearing", key: string): number {
    const entity = (kind === "point" ? graph.points : graph.bearings).find((item) => item.key === key);
    if (!entity?.sourceSpan) throw new Error(`Missing ${kind} reference or source location: ${key}`);
    return entity.sourceSpan.startLine;
  }
  const byLine = new Map<number, AstBlock>();
  const index = (block: AstBlock) => { byLine.set(block.sourceSpan.startLine, block); block.children.forEach(index); };
  blocks?.forEach(index);
  const literal = (block: AstBlock): unknown => ({
    line: block.sourceSpan.startLine, text: block.text, children: block.children.map(literal)
  });
  return {
    ...(blocks ? { notes: graph.notes.map(note => {
      const block = byLine.get(note.sourceSpan.startLine)!;
      return {
        line: note.sourceSpan.startLine, origin: note.origin,
        target: { kind: note.target.kind, line: refLine(note.target.kind, note.target.key) },
        text: block.text, literal: note.origin === "note" ? block.children.map(literal) : []
      };
    }) } : {}),
    // Portable expectations flatten declaration metadata; they are not raw Graph IR.
    points: graph.points.map(({ key, declaration: { form, role, status }, id }) => ({
      line: refLine("point", key), form, role, status, id
    })),
    bearings: graph.bearings.map(({ key, kind, sources, target, derivedBy, handle }) => ({
      line: refLine("bearing", key), kind,
      sources: sources.map((ref) => refLine("point", ref.key)),
      target: { kind: target.kind, line: refLine(target.kind, target.key) },
      derivedBy, handle
    }))
  };
}
