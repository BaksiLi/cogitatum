import { describe, expect, it } from "vitest";
import { explainSource, parseAnnotation } from "./index.js";

// Spelling and coordinates are source evidence, not different language meanings.
const semantics = (value: unknown) => JSON.parse(JSON.stringify(value, (key, value) =>
  key === "raw" || key === "source" || /Span(?:s)?$/.test(key) ? undefined :
    key === "text" && typeof value === "string" ? value.replace(/^\[(?:point|node)(?=$|\s)/, "[.").replace(/^\[(?:bearing|edge)(?=$|\s)/, "[_") : value));
const families = { point: [".", "point", "node"], bearing: ["_", "bearing", "edge"] };

describe("one Point/Bearing family grammar", () => {
  it.each([
    ["point", ""], ["point", " @p"], ["point", " @p +> @q; @r"], ["point", " use @p"],
    ["point", " use @p /> @r; @s"], ["point", " note"],
    ["bearing", " @p +> @q; @r"], ["bearing", " @p, @q challenges @r; @s"],
    ["bearing", " @p answers @q"], ["bearing", " use @r"], ["bearing", " note"],
    ["point", " bad"], ["point", " use"], ["point", " use @p; bad"],
    ["bearing", ""], ["bearing", " bad"], ["bearing", " use @r; @alias"],
    ["bearing", " @p UNDERCUTS @q"], ["point", " note @target"], ["bearing", " note; @alias"]
  ])("gives %s aliases the same parsed operation for suffix %s", (family, suffix) => {
    const values = families[family as keyof typeof families].map(word => {
      const raw = word + suffix, result = parseAnnotation(raw);
      if (result.annotation) expect(result.annotation.raw).toBe(raw);
      return semantics(result);
    });
    for (const value of values) expect(value).toEqual(values[0]);
  });

  it.each(["+>", "->", "/>", "~>", "supports", "challenges", "concerns", "answers", "repliesTo", "clarifies"])(
    "shares every Bearing kind and authored target requirement: %s", kind => {
      const results = families.bearing.map(alias => semantics(parseAnnotation(`${alias} @p, @q ${kind} @target; @route`)));
      results.forEach(result => expect(result).toEqual(results[0]));
    }
  );

  it.each(["", " @p", " use @p", " bad", " note", " note @bad"])(
    "retains equivalent failed Point contexts and literal boundaries without a closing bracket: %s", suffix => {
      const results = families.point.map(alias => explainSource(`- [C @outer] Outer.\n  - [${alias}${suffix}\n    - [G] Child.\n- [C @p] Original.`));
      results.slice(1).forEach(result => expect(semantics(result)).toEqual(semantics(results[0])));
    }
  );

  it.each(["", " @p +> @q", " use @r", " bad", " note", " note @bad"])(
    "retains equivalent failed Bearing contexts without a closing bracket: %s", suffix => {
      const results = families.bearing.map(alias => explainSource(`- [C @outer] Outer.\n  - [${alias}${suffix}\n    - [G/] Child.`));
      results.slice(1).forEach(result => expect(semantics(result)).toEqual(semantics(results[0])));
    }
  );

  it("has one semantic result for complete mixed construction, use and note documents", () => {
    const documents = families.point.flatMap(point => families.bearing.map(bearing =>
      `- [${point} @p] Premise.\n- [C @q] Claim.\n- [${bearing} @p supports @q; @r] Description.\n  - [${bearing} note] Route.\n- [${point} use @p] Local.\n  - [${point} note] Shared.\n- [${bearing} use @r] Local route.`
    ));
    const results = documents.map(source => semantics(explainSource(source)));
    results.forEach(result => expect(result).toEqual(results[0]));
  });

  it("reserves only family tokens and diagnoses case without promoting prose prefixes", () => {
    for (const word of ["pointless", "nodes", "bearings", "edgewise", "noteworthy"]) {
      const result = explainSource(`- [${word}] Prose.`);
      expect(result.documents[0].blocks[0].annotation).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    }
    for (const word of ["Point", "NODE", "Bearing", "EDGE"]) {
      expect(explainSource(`- [${word} @p] Case.`).diagnostics.some(d => d.severity === "error")).toBe(true);
    }
  });

  it.each(["BEARING", "EDGE"])("keeps %s's failed operation boundary after wrong case", family => {
    const result = explainSource(`- [C] Outer.\n  - [${family} use @r]\n    - [G] Cannot acquire an outer default.`);
    expect(result.documents[0].blocks[0].children[0].annotation).toMatchObject({ kind: "bearingUse", syntaxErrors: ["reference"] });
    expect(result.graphs[0].bearings).toEqual([]);
    expect(result.diagnostics.map(d => d.code)).toContain("BEARING_USE_REQUIRES_EXPLICIT_TARGET");
  });

  it("makes the published ordinary-body counterexample an explicit 0.6 migration boundary", () => {
    const result = explainSource("- [C @outer] Outer.\n  - [point @p] Previously ordinary body.\n    - [G @g] Reason.");
    const g = result.graphs[0];
    expect(g.points.map(p => p.id)).toEqual(["outer", "p", "g"]);
    expect(g.bearings[0].target).toEqual({ kind: "point", key: g.points[1].key });
    expect(result.version).toBe("0.6.0");
  });
});
