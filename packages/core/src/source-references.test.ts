import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeSourceReferences, explainSource } from "./index.js";
import type { ReferencedName, SourceParseMode } from "./index.js";

function names(source: string, mode: SourceParseMode = "document"): ReferencedName[][] {
  const result = analyzeSourceReferences(source, mode);
  expect(result.references.status).toBe("complete");
  if (result.references.status !== "complete") throw new Error(JSON.stringify(result.diagnostics));
  return result.references.units;
}

describe("source reference analysis", () => {
  it("distinguishes connected names without written references from disconnected names with uses", () => {
    const connected = "- [C @sampling] Wait ten minutes before sampling.\n  - [G @measurement; @route] Drift was below 0.1% after ten minutes.";
    expect(names(connected)[0].map(name => [name.name, name.references])).toEqual([
      ["sampling", []], ["measurement", []], ["route", []]
    ]);
    expect(explainSource(connected).graphs[0].bearings).toHaveLength(1);

    const disconnected = "- [. use @measurement] Revisit the calibration record.\n- [. @measurement] Drift was below 0.1% after ten minutes.";
    const [measurement] = names(disconnected)[0];
    expect(measurement.references).toEqual([{ kind: "point-use", sourceSpan: expect.objectContaining({ startLine: 1 }) }]);
    expect(measurement.sourceSpan.startLine).toBe(2);
    const graph = explainSource(disconnected).graphs[0];
    expect(measurement.ref).toEqual({ kind: "point", key: graph.points[0].key });
    expect(graph.bearings).toEqual([]);
    expect(graph.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["DISCONNECTED_ANCHORED_MATERIAL"]);
  });

  it("retains ordered explicit sources, forward Point/Bearing uses and typed targets", () => {
    const source = [
      "- [_ use @route] Review the original support.",
      "- [. use @measurement] Keep this occurrence's qualification.",
      "- [_ @calibration, @measurement supports @sampling; @route] Joint support.",
      "- [O @bias /> @route; @attack] A shared offset may invalidate the route.",
      "- [C @sampling] Wait ten minutes before sampling.",
      "- [G @measurement] Drift was below 0.1% after ten minutes.",
      "- [G @calibration] The instrument used an independent reference."
    ].join("\n");
    const inventory = names(source)[0];
    const byName = new Map(inventory.map(name => [name.name, name]));
    expect(inventory.map(name => name.name)).toEqual(["route", "bias", "attack", "sampling", "measurement", "calibration"]);
    expect(byName.get("route")).toMatchObject({ ref: { kind: "bearing" }, sourceSpan: { startLine: 3 }, references: [
      { kind: "bearing-use", sourceSpan: { startLine: 1 } },
      { kind: "target", sourceSpan: { startLine: 4 } }
    ] });
    expect(byName.get("sampling")).toMatchObject({ ref: { kind: "point" }, references: [{ kind: "target", sourceSpan: { startLine: 3 } }] });
    expect(byName.get("measurement")?.references).toEqual([
      { kind: "point-use", sourceSpan: expect.objectContaining({ startLine: 2 }) },
      { kind: "source", sourceIndex: 1, sourceSpan: expect.objectContaining({ startLine: 3 }) }
    ]);
    expect(byName.get("calibration")?.references).toEqual([{ kind: "source", sourceIndex: 0, sourceSpan: expect.objectContaining({ startLine: 3 }) }]);
    expect(byName.get("bias")?.references).toEqual([]);
    expect(byName.get("attack")?.references).toEqual([]);
  });

  it("keeps the Point use separate from its newly constructed local Bearing and local selectors", () => {
    const source = [
      "- [C @old] The old conclusion.",
      "  - [G @reason; @old-step] The reason.",
      "- [C @new] The new conclusion.",
      "  - [G use @reason; @new-step] A new occurrence.",
      "    - [O/] Local assessment.",
      "- [_ use @old-step] The old Bearing keeps its endpoints.",
      "  - [G/] A qualification of the old Bearing.",
      "- [C use @new +> @old; @bridge] Explicit use attachment."
    ].join("\n");
    const inventory = names(source)[0];
    expect(inventory.map(name => [name.name, name.references.map(reference => reference.kind)])).toEqual([
      ["old", ["target"]], ["reason", ["point-use"]], ["old-step", ["bearing-use"]],
      ["new", ["point-use"]], ["new-step", []], ["bridge", []]
    ]);
    const compiled = explainSource(source);
    const newStep = compiled.graphs[0].bearings.find(bearing => bearing.handle === "new-step")!;
    expect(newStep.sources).toEqual([inventory.find(name => name.name === "reason")!.ref]);
    expect(newStep.target).toEqual(inventory.find(name => name.name === "new")!.ref);
  });

  it("does not invent references for linked members or count prose and literal note descendants", () => {
    const source = [
      "- [C @sampling] See @measurement in ordinary prose.",
      "  - [linked; @route] Joint explanation.",
      "    - [G @measurement] Measured drift.",
      "    - [G @calibration] Calibration record.",
      "    - [note] Quoted markup.",
      "      - [C @sampling] A literal duplicate.",
      "      - [_ use @route] Literal reuse.",
      "      - [O /> @missing] Literal target.",
      "      - [. use @calibration] Literal Point use.",
      "- [O-ring] Not an annotation: @sampling.",
      "- Ordinary body mentions @route and [G use @measurement]."
    ].join("\n");
    expect(names(source)[0].map(name => [name.name, name.references])).toEqual([
      ["sampling", []], ["route", []], ["measurement", []], ["calibration", []]
    ]);
  });

  it("isolates identical names and compilation keys in separate host units with original spans", () => {
    const source = [
      "Mention @record in host prose.",
      "  ```cog", "  -    [. use @record] The first occurrence.", "  - [C @record] First record.", "  ```",
      "```cogitatum", "- [C @record] Second record.", "```",
      "<!--", "```cog", "- [. use @record] Hidden.", "```", "-->",
      "```text", "- [. use @record] Literal code.", "```"
    ].join("\r\n");
    const [first, second] = names(source, "host");
    expect(first[0].name).toBe(second[0].name);
    expect(first[0].ref).toEqual(second[0].ref);
    expect(first[0].sourceSpan.startLine).toBe(4);
    expect(first[0].references).toEqual([{ kind: "point-use", sourceSpan: {
      startLine: 3, startColumn: 8, endLine: 3, endColumn: source.split("\r\n")[2].length + 1
    } }]);
    expect(second[0].sourceSpan.startLine).toBe(7);
    expect(second[0].references).toEqual([]);
  });

  it.each([
    ["duplicate Point", "- [C @a] First.\n- [C @a] Second.", "DUPLICATE_ID"],
    ["unknown Point", "- [C @a] Claim.\n- [. use @missing] Missing.", "UNKNOWN_POINT_REFERENCE"],
    ["unknown source", "- [C @a] Claim.\n- [_ @missing +> @a] Missing.", "UNKNOWN_SOURCE"],
    ["unknown target", "- [G @a +> @missing] Missing.", "UNKNOWN_TARGET"],
    ["wrong use kind", "- [C @a] Claim.\n- [_ use @a] Wrong kind.", "POINT_IS_NOT_BEARING_REFERENCE"],
    ["wrong target kind", "- [C @a] Claim.\n- [O /> @a] Wrong target kind.", "CHALLENGE_REQUIRES_BEARING_TARGET"],
    ["malformed use", "- [C @a] Claim.\n- [. use] Missing operand.", "MALFORMED_POINT_USE"],
    ["malformed annotation", "- [C @a] Claim.\n- [G use @a", "MALFORMED_ANNOTATION_PREFIX"],
    ["invalid layout", "- [C @a] Claim.\n  - Spaced.\n\t- [. use @a] Invalid.", "MIXED_INDENTATION"],
    ["unsupported line", "- [C @a] Claim.\n[. use @a] Missing bullet.", "UNSUPPORTED_LINE"],
    ["duplicate handle", "- [C @a] Claim.\n  - [G; @route] First.\n  - [G; @route] Second.", "DUPLICATE_BEARING_HANDLE"],
    ["conflicting name", "- [C @a] Claim.\n  - [G; @a] Conflict.", "POINT_BEARING_ID_CONFLICT"],
    ["duplicate explicit source", "- [C @a] Claim.\n- [G @b] Reason.\n- [_ @b, @b +> @a] Repeated.", "DUPLICATE_BEARING_SOURCES"]
  ])("withholds all counts on %s instead of reporting false zeroes", (_label, source, code) => {
    const result = analyzeSourceReferences(source);
    expect(result.references).toEqual({ status: "unavailable", reason: "source-errors" });
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
    expect(result.diagnostics).toEqual(explainSource(source).diagnostics);
  });

  it.each([
    ["unclosed", "```cog\n- [. use @a] Omitted.", "UNCLOSED_COGITATUM_FENCE"],
    ["nested", "> ```cog\n> - [. use @a] Omitted.\n> ```", "UNSUPPORTED_NESTED_COGITATUM_FENCE"],
    ["empty", "```cog\n```", "EMPTY_COGITATUM_FENCE"]
  ])("declines even valid selected units when the host has an %s region", (_label, omitted, code) => {
    const source = "```cog\n- [C @a] Selected.\n```\n\n" + omitted;
    const result = analyzeSourceReferences(source, "host");
    expect(result.references).toEqual({ status: "unavailable", reason: "source-errors" });
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
  });

  it("distinguishes a host with no selected regions from a complete empty document", () => {
    expect(names("Ordinary host prose with @names.", "host")).toEqual([]);
    expect(names("")).toEqual([[]]);
    const isolated = "```cog\n- [C @a] First.\n```\n```cog\n- [. use @a] Not in this unit.\n```";
    expect(analyzeSourceReferences(isolated, "host").references.status).toBe("unavailable");
  });

  it("preserves source, note ownership, identities and future local move behaviour", () => {
    const source = "- [C @first] First.\r\n  - [G @reason; @route] Reason.\r\n    - [note] Owned by the declaration.\r\n- [C @second] Second.\r\n  - [G use @reason; @other] Local prose.\r\n    - [note] Owned by the use.\r\n";
    const before = explainSource(source);
    analyzeSourceReferences(source);
    expect(explainSource(source)).toEqual(before);
    expect(analyzeSourceReferences(source).units[0].source).toBe(source);
    expect(before.explanations[0].entries.filter(entry => entry.recognition.kind === "note").map(entry => entry.effects)).toEqual([
      [{ kind: "preserveNote", parentSpan: before.documents[0].blocks[0].children[0].sourceSpan }],
      [{ kind: "preserveNote", parentSpan: before.documents[0].blocks[1].children[0].sourceSpan }]
    ]);
    const moved = "- [C @first] First.\n  - [G @reason; @route] Reason.\n  - [G use @reason; @other] Local prose.\n- [C @second] Second.";
    const originalTarget = before.graphs[0].bearings.find(bearing => bearing.handle === "other")!.target;
    const movedCompilation = explainSource(moved);
    const movedTarget = movedCompilation.graphs[0].bearings.find(bearing => bearing.handle === "other")!.target;
    expect(originalTarget).toEqual({ kind: "point", key: before.graphs[0].points.find(point => point.id === "second")!.key });
    expect(movedTarget).toEqual({ kind: "point", key: movedCompilation.graphs[0].points.find(point => point.id === "first")!.key });
    expect(names(moved)[0].find(name => name.name === "reason")?.references).toHaveLength(1);
  });

  it("projects every current conformance source without creating a separate resolution policy", () => {
    for (const directory of ["core", "diagnostics", "host"]) {
      const root = fileURLToPath(new URL(`../../../fixtures/${directory}/`, import.meta.url));
      for (const filename of readdirSync(root).filter(filename => filename.endsWith(".md"))) {
        const source = readFileSync(root + filename, "utf8");
        const mode = directory === "host" ? "host" : "document";
        const compiled = explainSource(source, mode);
        const analysis = analyzeSourceReferences(source, mode);
        expect(analysis.diagnostics, filename).toEqual(compiled.diagnostics);
        expect(analysis.references.status, filename).toBe(compiled.diagnostics.some(diagnostic => diagnostic.severity === "error") ? "unavailable" : "complete");
      }
    }
  });
});
