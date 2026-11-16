import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileSource } from "@cogitatum/core";
import { prepareView } from "@cogitatum/core/host";
import { mapContext } from "../packages/view/src/projection.js";
import { renderShowcase } from "./host-showcase.mjs";

const source = readFileSync(new URL("../examples/host-showcase.cog.md", import.meta.url), "utf8");

describe("shared host showcase", () => {
  it("covers quiet relevance, awaiting roles, local use and joint support without errors", () => {
    const projection = prepareView(source, "document"), unit = projection.units[0];
    expect(projection.diagnostics.filter(item => item.severity === "error")).toEqual([]);
    const context = mapContext(unit);
    expect(context.quiet).toHaveLength(1);
    expect(context.awaiting.map(item => item.awaits).sort()).toEqual(["challenges", "supports"]);
    expect(unit.graph.bearings.some(item => item.sources.length === 2 && item.kind === "supports")).toBe(true);
    expect(unit.occurrences.some(item => item.references.some(ref => ref.kind === "uses"))).toBe(true);
  });

  it.each(["obsidian", "logseq"])("preserves the same compiled source through the %s native block", host => {
    const document = compileSource(source, "document"), wrapped = renderShowcase(source, host);
    // Logseq owns the surrounding Markdown list; its native fenced editor receives the block within it.
    const fenced = host === "logseq" ? wrapped.split("\n").map(line => line.slice(2)).join("\n") : wrapped;
    if (host === "logseq") expect(wrapped.split("\n").slice(0, -1).every((line, index) => line.startsWith(index ? "  " : "- "))).toBe(true);
    const output = prepareView(fenced, "host");
    expect(output.units).toHaveLength(1);
    const graph = output.units[0].graph;
    expect(graph.points.map(point => [point.id, point.text])).toEqual(document.graphs[0].points.map(point => [point.id, point.text]));
    expect(graph.bearings.map(bearing => [bearing.kind, bearing.sources, bearing.target, bearing.targetBy]))
      .toEqual(document.graphs[0].bearings.map(bearing => [bearing.kind, bearing.sources, bearing.target, bearing.targetBy]));
    expect(output.diagnostics.map(item => item.code)).toEqual(document.diagnostics.map(item => item.code));
  });

  it("keeps backticks and literal whitespace inside an exported fence", () => {
    const literal = "- [C] Use `code`.\n  ```\n  literal body\n  ```\n";
    expect(renderShowcase(literal, "obsidian")).toMatch(/^````cog\n[\s\S]*\n````\n$/);
    expect(renderShowcase(literal, "document")).toBe(literal);
    expect(() => renderShowcase(literal, "unknown")).toThrow("Choose");
  });
});
