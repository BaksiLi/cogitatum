import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainSource } from "../../core/src/index.js";
import type { ExplainedSource, SourceParseMode } from "../../core/src/index.js";
import { projectReading, type ReadingOccurrence, type ReadingProjection } from "./reading-projection.js";

const project = (source: string, mode: SourceParseMode = "document") => projectReading(source, explainSource(source, mode));
const occurrence = (reading: ReadingProjection, line: number) => reading.rows[line - 1] as ReadingOccurrence;
const route = (reading: ReadingProjection, line: number) =>
  reading.units.flatMap(unit => unit.bearings).find(item => item.occurrenceId === occurrence(reading, line).id)!;
const lineOf = (reading: ReadingProjection, id: string) =>
  reading.units.flatMap(unit => unit.occurrences).find(item => item.id === id)!.line;

describe("source-aware Reading projection", () => {
  it.each(["document", "host"] as const)("preserves source-backed object notes across %s serialization and reuse", mode => {
    const fixture = readFileSync(new URL("../../../fixtures/core/object-note-ownership.cog.md", import.meta.url), "utf8").trimEnd();
    const source = mode === "host" ? "Host prose.\n\n  ```cog\n" + fixture.split("\n").map(line => "  " + line).join("\n") + "\n  ```" : fixture;
    const exported = JSON.parse(JSON.stringify(explainSource(source, mode))) as ExplainedSource;
    const result = projectReading(source, exported), unit = result.units[0];
    expect(result.rows.map(row => row.raw)).toEqual(source.split("\n"));
    expect(unit.notes).toHaveLength(7);
    expect(unit.notes.filter(note => note.record.origin === "constructor-description")).toHaveLength(1);
    const offset = mode === "host" ? 3 : 0;
    expect(unit.notes.map(note => lineOf(result, note.occurrenceId))).toEqual([4, 5, 8, 11, 13, 14, 16].map(line => line + offset));
    expect(unit.notes[1].content.map(row => row.text)).toEqual(["Here yesterday.", "[point @ignored] Literal source."]);
    expect(unit.notes[1].content[0]).toBe(occurrence(result, 5 + offset));
    expect(unit.notes[1].content[1]).toMatchObject({ recognition: { kind: "literal" }, references: [] });
    expect(unit.notes[1].record.target).toEqual(unit.notes[3].record.target);
    expect(unit.notes[1].occurrenceId).not.toBe(unit.notes[3].occurrenceId);
    expect(unit.graph.bearings).toHaveLength(2);
    expect(occurrence(result, 10 + offset).references).toEqual([]);
    const corrupted = structuredClone(exported);
    corrupted.graphs[0].notes.pop();
    expect(() => projectReading(source, corrupted)).toThrow("note evidence");
  });

  describe.each(["document", "host"] as const)("Unicode separators in %s input", mode => {
    it.each(["\u2028", "\u2029"])("preserves %j inside a source occurrence", separator => {
      const lines = [
        `- [C @shared] Shared${separator}prose.`, "- [C @other] Other claim.",
        `  - [G use @shared; @route] Local${separator}wording.`,
        `  - [note] Quoted${separator}note.`, `    - [G @literal] Literal${separator}syntax.`,
        `- Ordinary${separator}body.`
      ];
      const source = (mode === "host" ? ["  ```cog", ...lines.map(line => "  " + line), "  ```"] : lines).join("\r\n");
      const compiled = explainSource(source, mode);
      expect(compiled.diagnostics).toEqual([]);
      expect(compiled.graphs[0].points).toHaveLength(2);
      expect(compiled.graphs[0].bearings).toHaveLength(1);
      const result = projectReading(source, compiled), offset = mode === "host" ? 1 : 0;
      expect(result.source).toBe(source);
      expect(result.rows.map(row => row.raw)).toEqual(source.split("\r\n"));
      expect(result.units[0].occurrences.map(item => item.text)).toEqual([
        `Shared${separator}prose.`, "Other claim.", `Local${separator}wording.`,
        `Quoted${separator}note.`, `[G @literal] Literal${separator}syntax.`, `Ordinary${separator}body.`
      ]);
      const shared = occurrence(result, 1 + offset), local = occurrence(result, 3 + offset);
      expect(local.references[0]).toMatchObject({ kind: "uses", ref: shared.references[0].ref });
      expect(local.id).not.toBe(shared.id);
      expect(route(result, 3 + offset).sources[0].occurrenceId).toBe(local.id);
      expect(route(result, 3 + offset).target.occurrenceId).toBe(occurrence(result, 2 + offset).id);
      expect(occurrence(result, 5 + offset)).toMatchObject({ recognition: { kind: "literal" }, references: [] });
      for (const item of result.units[0].occurrences) {
        expect(item.sourceSpan.startLine).toBe(item.sourceSpan.endLine);
        const authored = lines[item.line - offset - 1].trimStart().slice(2);
        expect(item.raw.slice(item.sourceSpan.startColumn - 1, item.sourceSpan.endColumn - 1)).toBe(authored);
      }
      expect(() => projectReading(source.replace(separator, "!"), compiled)).toThrow("source changed");
    });
  });

  it("retains body, blank lines, note subtrees and occurrence-local prose without inventing entities", () => {
    const source = [
      "- Ordinary body.", "", "- [C @p] Shared text.", "  - [note] A quotation.",
      "    - [G @fake] Literal markup.", "- [C @other] Other.",
      "  - [G use @p] This use has local prose."
    ].join("\r\n");
    const result = project(source);
    expect(result.source).toBe(source);
    expect(result.rows.map(row => row.raw)).toEqual(source.split("\r\n"));
    expect(result.rows[1]).toMatchObject({ kind: "source", raw: "" });
    expect(occurrence(result, 1).references).toEqual([]);
    expect(occurrence(result, 4).references).toEqual([]);
    expect(occurrence(result, 5)).toMatchObject({ text: "[G @fake] Literal markup.", recognition: { kind: "literal" }, references: [] });
    expect(occurrence(result, 7)).toMatchObject({ text: "This use has local prose.", references: [
      { kind: "uses", ref: { kind: "point", key: "_p1" }, name: "p" },
      { kind: "constructs", ref: { kind: "bearing" } }
    ] });
    expect(result.units[0].graph.points[0].text).toBe("Shared text.");
    expect(result.units[0].graph.points.some(point => point.id === "fake")).toBe(false);
  });

  it("uses compiler context for implicit targets and declaration locations for explicit targets", () => {
    const source = [
      "- [C @shared] Shared.", "- [C @other] Other.",
      "  - [G use @shared] A local reuse.", "    - [O] Objection here.",
      "    - [O -> @shared] Explicit concern.", "  - [linked; @joint]",
      "    - [G use @shared] Reused joint member.", "    - [G] Other member."
    ].join("\n");
    const result = project(source);
    expect(result.diagnostics).toEqual([]);
    expect(lineOf(result, route(result, 4).target.occurrenceId)).toBe(3);
    expect(route(result, 4).target.basis).toBe("context");
    expect(lineOf(result, route(result, 5).target.occurrenceId)).toBe(1);
    expect(route(result, 5).target.basis).toBe("declaration");
    expect(route(result, 6).sources.map(endpoint => [lineOf(result, endpoint.occurrenceId), endpoint.basis])).toEqual([
      [7, "linked-member"], [8, "linked-member"]
    ]);
  });

  it("preserves a local Bearing-use context separately from the Bearing's canonical construction", () => {
    const source = [
      "- [C @c] Claim.", "  - [G; @b] Ground.", "    - [O/] Concern.",
      "- [_ use @b] Local discussion.", "  - body", "    - [O/] Local concern.",
      "  - [O /> @b] Explicit concern."
    ].join("\n");
    const result = project(source);
    expect([3, 6, 7].map(line => lineOf(result, route(result, line).target.occurrenceId))).toEqual([2, 4, 2]);
    expect(route(result, 6).target.ref.kind).toBe("bearing");
    expect(occurrence(result, 4).references).toMatchObject([{ kind: "uses", ref: route(result, 6).target.ref }]);
    expect(result.diagnostics.map(d => d.code)).toEqual(["IMPLICIT_ATTACHMENT_THROUGH_BODY"]);
  });

  it("keeps partial source and rejected names visible without turning rejected summaries into graph references", () => {
    const source = [
      "- [C @c] First.", "  - [G +> @missing] Survives.",
      "- [C @c] Duplicate.", "Not a bullet.", "- [_ use @unknown]", "  - [O/] No route."
    ].join("\n");
    const result = project(source);
    expect(occurrence(result, 1).references).toEqual([]);
    expect(occurrence(result, 3).references).toEqual([]);
    expect(occurrence(result, 5).references).toEqual([]);
    expect(occurrence(result, 2).references).toMatchObject([{ kind: "declares", ref: { kind: "point" } }]);
    expect(result.rows[3]).toMatchObject({ kind: "source", raw: "Not a bullet.", diagnostics: [{ code: "UNSUPPORTED_LINE" }] });
    expect(result.units[0].bearings).toEqual([]);
    expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("retains ordered independent Bearings, including identical endpoints and Bearing cycles", () => {
    const source = [
      "- [C @p] Same.", "- [C @q] Same.", "- [. @isolated] Alone.",
      "- [_ @p, @q +> @q; @first]", "- [_ @q, @p +> @q; @second]",
      "- [_ @p +> @right; @left]", "- [_ @q /> @left; @right]"
    ].join("\n");
    const result = project(source), unit = result.units[0];
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["DISCONNECTED_ANCHORED_MATERIAL"]);
    expect(unit.bearings.map(item => item.bearing)).toEqual(unit.graph.bearings);
    expect(unit.bearings.map(item => item.sources.map(source => source.ref))).toEqual(unit.graph.bearings.map(bearing => bearing.sources));
    expect(unit.occurrences).toHaveLength(7);
    expect(new Set(unit.bearings.map(item => item.occurrenceId)).size).toBe(4);
    expect(lineOf(result, route(result, 6).target.occurrenceId)).toBe(7);
    expect(lineOf(result, route(result, 7).target.occurrenceId)).toBe(6);
  });

  it("scopes repeated keys and authored names to host units and preserves the complete original host", () => {
    const source = [
      "# Host 😀", "", "  ```cog", "  - [C @same] 第一段。",
      "    - [G] 理由。", "  ```", "Between.", "```cog",
      "- [C @same] Second.", "  - [G] Another.", "```", ""
    ].join("\r\n");
    const result = project(source, "host");
    expect(result.source).toBe(source);
    expect(result.rows.map(row => row.raw)).toEqual(source.split("\r\n"));
    expect(result.units.map(unit => unit.graph.points[0].key)).toEqual(["_p1", "_p1"]);
    expect(occurrence(result, 4).id).not.toBe(occurrence(result, 9).id);
    expect(occurrence(result, 4).sourceSpan.startColumn).toBe(5);
    expect(result.rows[6]).toMatchObject({ kind: "source", raw: "Between.", unitIndex: undefined });
    expect(route(result, 5).target.occurrenceId).toBe(occurrence(result, 4).id);
    expect(route(result, 10).target.occurrenceId).toBe(occurrence(result, 9).id);
  });

  it.each([
    "No active source.\n\n```js\n- [C] Literal.\n```",
    "```cog\n```",
    "```cog\n- [C] Unclosed.",
    "> ```cog\n> - [C] Nested.\n> ```"
  ])("preserves source-selection failures and empty units: %s", source => {
    const compiled = explainSource(source, "host"), result = projectReading(source, compiled);
    expect(result.rows.map(row => row.raw)).toEqual(source.split("\n"));
    expect(result.diagnostics).toEqual(compiled.diagnostics);
    expect(result.units.flatMap(unit => unit.bearings)).toEqual([]);
  });

  it("rejects stale document/host text and incomplete structural evidence instead of guessing", () => {
    const source = "- [C] Claim.\n  - [G] Reason.";
    const explained = explainSource(source);
    expect(() => projectReading(source + "\n", explained)).toThrow("document source changed");
    const host = "```cog\n" + source + "\n```", hostResult = explainSource(host, "host");
    expect(() => projectReading(host.replace("Claim.", "Other."), hostResult)).toThrow("selected source changed");
    const stale = structuredClone(explained);
    stale.explanations[0].entries[1].effects = stale.explanations[0].entries[1].effects.filter(effect => effect.kind !== "implicitAttachment");
    expect(() => projectReading(source, stale)).toThrow("attachment context");
    expect(() => projectReading(source, { ...explained, explanations: [] })).toThrow("unaligned source units");
    expect(() => projectReading(source, { ...explained, version: "0.4.0" })).toThrow("unsupported format");
  });

  it("does not mutate compiler output", () => {
    const source = "- [C @c] Claim.\n  - [G] Ground.";
    const compiled = explainSource(source), before = structuredClone(compiled);
    const freeze = (value: unknown) => {
      if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(compiled);
    projectReading(source, compiled);
    expect(compiled).toEqual(before);
  });
});

const fixtureRoot = new URL("../../../fixtures/", import.meta.url);
const manifest: { fixtures: { file: string; input: SourceParseMode }[] } =
  JSON.parse(readFileSync(new URL("manifest.json", fixtureRoot), "utf8"));

describe("Reading over the conformance corpus", () => {
  it.each(manifest.fixtures)("$file", ({ file, input }) => {
    const source = readFileSync(new URL(file, fixtureRoot), "utf8");
    const compiled: ExplainedSource = explainSource(source, input);
    const result = projectReading(source, compiled);
    expect(result.diagnostics).toEqual(compiled.diagnostics);
    expect(result.units.map(unit => unit.bearings.map(item => item.bearing))).toEqual(compiled.graphs.map(graph => graph.bearings));
    for (const unit of result.units) {
      const ids = new Set(unit.occurrences.map(occurrence => occurrence.id));
      expect(unit.bearings.every(item => [item.target, ...item.sources].every(endpoint => ids.has(endpoint.occurrenceId)))).toBe(true);
    }
  });
});
