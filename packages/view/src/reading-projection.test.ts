import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainSource } from "../../core/src/index.js";
import type { ExplainedSource, SourceParseMode } from "../../core/src/index.js";
import { projectReading, type ReadingProjection } from "./reading-projection.js";

const project = (source: string, mode: SourceParseMode = "document") => projectReading(source, explainSource(source, mode));
const occurrence = (reading: ReadingProjection, line: number) =>
  reading.units.flatMap(unit => unit.occurrences).find(item => item.line === line)!;
const route = (reading: ReadingProjection, line: number) =>
  reading.units.flatMap(unit => unit.bearings).find(item => item.occurrenceId === occurrence(reading, line).id)!;
const lineOf = (reading: ReadingProjection, id: string) =>
  reading.units.flatMap(unit => unit.occurrences).find(item => item.id === id)!.line;

describe("source-aware Reading projection", () => {
  it.each(["document", "host"] as const)("keeps Q/ questions and replies attached to their distinct objects in %s input", mode => {
    const lines = [
      "- [C] The visitor may be familiar.",
      "  - [G] The dog did not bark.",
      "    - [Q/] Which conditions make silence relevant?",
      "      - [R] Check whether the dog was awake."
    ];
    const source = (mode === "host" ? ["  ```cog", ...lines.map(line => "  " + line), "  ```"] : lines).join("\r\n");
    const exported = JSON.parse(JSON.stringify(explainSource(source, mode))) as ExplainedSource;
    const result = projectReading(source, exported), unit = result.units[0], offset = mode === "host" ? 1 : 0;
    expect(result.diagnostics).toEqual([]);
    expect(unit.graph.points).toHaveLength(4);
    expect(unit.graph.bearings.map(bearing => bearing.kind)).toEqual(["supports", "concerns", "repliesTo"]);
    expect(occurrence(result, 3 + offset)).toMatchObject({
      depth: 2, recognition: { kind: "role", role: "Q", selector: "attachment" },
      references: [{ kind: "declares", ref: { kind: "point" } }, { kind: "constructs", ref: { kind: "bearing" } }]
    });
    const question = route(result, 3 + offset), reply = route(result, 4 + offset);
    expect(question.target).toMatchObject({
      occurrenceId: occurrence(result, 2 + offset).id, ref: { kind: "bearing", key: unit.graph.bearings[0].key }
    });
    expect(reply.target).toMatchObject({
      occurrenceId: occurrence(result, 3 + offset).id, ref: { kind: "point", key: unit.graph.points[2].key }
    });
    expect(result.rows.map(row => row.raw)).toEqual(source.split("\r\n"));
  });

  it.each(["document", "host"] as const)("preserves question nesting without inventing Bearings in %s input", mode => {
    const lines = [
      "- [Q @scale] How fast is fast?",
      "  - [.] Seconds.",
      "  - [C] The instrument may resolve milliseconds.",
      "    - Ordinary context."
    ];
    const source = (mode === "host" ? ["```cog", ...lines, "```"] : lines).join("\n");
    const result = project(source, mode), unit = result.units[0], offset = mode === "host" ? 1 : 0;
    expect(result.diagnostics).toEqual([]);
    expect(unit.graph.points.map(point => point.text)).toEqual([
      "How fast is fast?", "Seconds.", "The instrument may resolve milliseconds."
    ]);
    expect(unit.graph.bearings).toEqual([]);
    expect(unit.bearings).toEqual([]);
    expect(unit.occurrences.map(item => [item.line - offset, item.depth, item.text])).toEqual([
      [1, 0, "How fast is fast?"], [2, 1, "Seconds."],
      [3, 1, "The instrument may resolve milliseconds."], [4, 2, "Ordinary context."]
    ]);
    expect(unit.occurrences.slice(0, 3).map(item => item.references.map(ref => ref.kind))).toEqual([
      ["declares"], ["declares"], ["declares"]
    ]);
    expect(result.rows.map(row => row.raw)).toEqual(source.split("\n"));
  });

  it.each([
    ["document", "  "], ["host", "  "], ["document", "\t"], ["host", "\t"]
  ] as const)("presents each multiline %s occurrence once with %j indentation and complete spans", (mode, indent) => {
    const content = [
      "- [C @p] The method may work",
      "  under room-temperature conditions.",
      `${indent}- [. note] A note`,
      `${indent}  with a second line.`,
      "",
      `${indent}  And another paragraph.`,
      `${indent.repeat(2)}- [G @hidden] Literal child`,
      `${indent.repeat(2)}  continued here.`,
      "- [point use @p] This occurrence",
      "  has local prose."
    ];
    const source = (mode === "host" ? ["  ```cog", ...content.map(line => "  " + line), "  ```"] : content).join("\r\n");
    const exported = JSON.parse(JSON.stringify(explainSource(source, mode))) as ExplainedSource;
    const result = projectReading(source, exported), unit = result.units[0], offset = mode === "host" ? 1 : 0;
    expect(result.diagnostics).toEqual([]);
    expect(result.rows.flatMap(row => row.raw.split("\n"))).toEqual(source.split("\r\n"));
    expect(unit.occurrences.map(row => [row.line - offset, row.sourceSpan.endLine - offset])).toEqual([
      [1, 2], [3, 6], [7, 8], [9, 10]
    ]);
    expect(unit.notes[0].content.map(row => row.text)).toEqual([
      "A note\nwith a second line.\n\nAnd another paragraph.",
      "[G @hidden] Literal child\ncontinued here."
    ]);
    expect(unit.occurrences[3].references).toMatchObject([{ kind: "uses", ref: unit.graph.notes[0].target }]);
    expect(unit.occurrences[3].text).toBe("This occurrence\nhas local prose.");
    expect(unit.graph.points).toHaveLength(1);
    expect(unit.graph.points[0].text).toBe("The method may work\nunder room-temperature conditions.");
    expect(() => projectReading(source.replace("second line", "altered line"), exported)).toThrow("source changed");
    const corrupt = structuredClone(exported);
    corrupt.documents[0].blocks[0].children[0].sourceSpan.endLine++;
    expect(() => projectReading(source, corrupt)).toThrow("AST / Explain occurrence correspondence");
  });

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
      "    - [O -> @shared] Explicit concern.", "  - [_ G; @joint]",
      "    - [. use @shared] Reused joint member.", "    - [.] Other member."
    ].join("\n");
    const result = project(source);
    expect(result.diagnostics).toEqual([]);
    expect(lineOf(result, route(result, 4).target.occurrenceId)).toBe(3);
    expect(route(result, 4).target.basis).toBe("context");
    expect(lineOf(result, route(result, 5).target.occurrenceId)).toBe(1);
    expect(route(result, 5).target.basis).toBe("declaration");
    expect(route(result, 6).sources.map(endpoint => [lineOf(result, endpoint.occurrenceId), endpoint.basis])).toEqual([
      [7, "local-bearing-member"], [8, "local-bearing-member"]
    ]);
  });

  it.each(["supports", "challenges", "concerns", "answers", "repliesTo", "clarifies"])(
    "projects a named %s declaration and use without changing roles, identity or source ownership",
    kind => {
      const source = [
        "- [O @target] Objection.", "- [C @outer] Local context.",
        `  - [Q @question ${kind} @target; @step] Which scale`, "    do you mean?",
        "    - [_ note] Attachment note.",
        `  - [Q use @question ${kind} @target; @again] Local explanation.`,
        "    - [C @answer answers @question] Seconds."
      ].join("\n");
      const result = project(source), unit = result.units[0];
      expect(result.diagnostics).toEqual([]);
      expect(unit.graph.points).toHaveLength(4);
      expect(unit.graph.bearings.map(bearing => bearing.kind)).toEqual([kind, kind, "answers"]);
      const declared = occurrence(result, 3), reused = occurrence(result, 6);
      expect(declared.recognition).toEqual({ kind: "role", role: "Q" });
      expect(reused.recognition).toEqual({ kind: "use", role: "Q", ref: { id: "question" } });
      expect(declared.text).toBe("Which scale\ndo you mean?");
      expect(reused.text).toBe("Local explanation.");
      expect(reused.references).toMatchObject([
        { kind: "uses", ref: declared.references[0].ref }, { kind: "constructs", ref: { kind: "bearing" } }
      ]);
      expect(route(result, 3).target.basis).toBe("declaration");
      expect(route(result, 6).sources[0].occurrenceId).toBe(reused.id);
      expect(lineOf(result, route(result, 7).target.occurrenceId)).toBe(3);
      expect(unit.notes[0].record.target).toEqual({ kind: "bearing", key: route(result, 3).bearing.key });
    }
  );

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
    expect(result.diagnostics).toEqual([]);
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
