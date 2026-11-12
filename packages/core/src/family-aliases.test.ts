import { describe, expect, it } from "vitest";
import { explainSource, parseAnnotation } from "./index.js";

// Spelling and coordinates are source evidence, not different language meanings.
const semantics = (value: unknown) => JSON.parse(JSON.stringify(value, (key, value) =>
  key === "raw" || key === "source" || /Span(?:s)?$/.test(key) ? undefined :
    key === "text" && typeof value === "string" ? value.replace(/^\[point(?=$|\s)/, "[.").replace(/^\[bearing(?=$|\s)/, "[_") : value));
const families = { point: [".", "point"], bearing: ["_", "bearing"] };

describe("one Point/Bearing family grammar", () => {
  it.each([
    ["point", "", "material"], ["point", " @p", "material"], ["point", " @p +> @q; @r", "material"],
    ["point", " use @p", "use"], ["point", " use @p /> @r; @s", "use"], ["point", " note", "note"],
    ["bearing", " @p +> @q; @r", "bearing"], ["bearing", " @p, @q challenges @r; @s", "bearing"],
    ["bearing", " @p answers @q", "bearing"], ["bearing", " use @r", "bearingUse"], ["bearing", " note", "note"],
    ["point", " bad", "invalid"], ["point", " use", "use"], ["point", " use @p; bad", "use"],
    ["bearing", "", "bearing"], ["bearing", " bad", "bearing"], ["bearing", " use @r; @alias", "bearingUse"],
    ["bearing", " @p UNDERCUTS @q", "bearing"], ["point", " note @target", "note"], ["bearing", " note; @alias", "note"]
  ])("gives active %s spellings the same operation and retires their alias for suffix %s", (family, suffix, retiredKind) => {
    const values = families[family as keyof typeof families].map(word => {
      const raw = word + suffix, result = parseAnnotation(raw);
      if (result.annotation) expect(result.annotation.raw).toBe(raw);
      return semantics(result);
    });
    for (const value of values) expect(value).toEqual(values[0]);
    const retired = parseAnnotation((family === "point" ? "node" : "edge") + suffix);
    expect(retired.diagnostics).toEqual([expect.objectContaining({ code: "RETIRED_FAMILY_ALIAS", severity: "error" })]);
    expect(retired.annotation?.kind).toBe(retiredKind);
  });

  it.each(["+>", "->", "/>", "~>", "supports", "challenges", "concerns", "answers", "respondsTo", "interprets"])(
    "shares every Bearing kind and authored target requirement: %s", kind => {
      const results = families.bearing.map(alias => semantics(parseAnnotation(`${alias} @p, @q ${kind} @target; @route`)));
      results.forEach(result => expect(result).toEqual(results[0]));
      const retired = explainSource(`- [. @p] First.\n- [. @q] Second.\n- [C @target] Target.\n- [edge @p, @q ${kind} @target; @route]`);
      expect(retired.diagnostics.map(d => d.code)).toEqual(["RETIRED_FAMILY_ALIAS"]);
      expect(retired.graphs[0].bearings).toEqual([]);
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
    for (const word of ["pointless", "nodes", "bearings", "edgeless", "edgewise", "noteworthy"]) {
      const result = explainSource(`- [${word}] Prose.`);
      expect(result.documents[0].blocks[0].annotation).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    }
    for (const word of ["Point", "Bearing"]) {
      expect(explainSource(`- [${word} @p] Case.`).diagnostics.some(d => d.severity === "error")).toBe(true);
    }
  });

  it.each(["node", "Node", "NODE", "nOdE"].flatMap(family =>
    ["", " @p", " @p +> @outer; @failed"].map(suffix => [family, suffix])
  ))("retires [%s%s] declarations without losing their Point boundary", (family, suffix) => {
    const result = explainSource(`- [C @outer] Outer.\n  - [${family}${suffix}] Material.\n    - [G @child] Reason for the material.`);
    const graph = result.graphs[0];
    expect(result.diagnostics.map(d => d.code)).toEqual(["RETIRED_FAMILY_ALIAS"]);
    expect(result.documents[0].blocks[0].children[0].annotation).toMatchObject({ kind: "material", syntaxErrors: ["retired"] });
    expect(graph.points.map(p => p.id)).toEqual(["outer", suffix ? "p" : undefined, "child"]);
    expect(graph.bearings).toEqual([expect.objectContaining({
      kind: "supports", sourceSpan: expect.objectContaining({ startLine: 3 }),
      sources: [{ kind: "point", key: graph.points[2].key }], target: { kind: "point", key: graph.points[1].key }
    })]);
  });

  it.each(["node", "Node", "NODE", "nOdE"])("keeps malformed and unclosed %s declarations as failed Point boundaries", family => {
    for (const suffix of ["", " @p", " bad"]) {
      const result = explainSource(`- [C @outer] Outer.\n  - [${family}${suffix}\n    - [G @child] Cannot attach outward.\n      - [O @detail] Challenges child.`);
      const graph = result.graphs[0];
      expect(result.diagnostics.filter(d => d.code === "RETIRED_FAMILY_ALIAS")).toHaveLength(1);
      expect(result.documents[0].blocks[0].children[0].annotation).toMatchObject({ kind: "invalid" });
      expect(graph.points.map(p => p.id)).toEqual(["outer", "child", "detail"]);
      expect(graph.bearings).toEqual([expect.objectContaining({
        kind: "challenges", sources: [{ kind: "point", key: graph.points[2].key }],
        target: { kind: "point", key: graph.points[1].key }
      })]);
    }
  });

  it.each(["edge", "Edge", "EDGE", "eDgE"].flatMap(family =>
    ["", " +> ^", "/", " @p +> @outer; @failed", " cases", " G", "G", " @p UNDERCUTS @outer"].flatMap(suffix =>
      ["]", "", "]Text."].map(closer => [family, suffix, closer]))
  ))("retires [%s%s%s and keeps descendants inside the failed boundary", (family, suffix, closer) => {
    const result = explainSource(`- [. @p] Material.\n- [C @outer] Outer.\n  - [${family}${suffix}${closer}\n    - [G @child] Cannot attach to outer.\n      - [O @detail] Challenges child.`);
    const graph = result.graphs[0];
    const header = result.documents[0].blocks[1].children[0];
    expect(result.diagnostics.filter(d => d.code === "RETIRED_FAMILY_ALIAS"), family + suffix + closer).toEqual([
      expect.objectContaining({ severity: "error", sourceSpan: expect.objectContaining({ startLine: 3 }) })
    ]);
    expect(graph.bearings, family + suffix + closer).toEqual([expect.objectContaining({
      kind: "challenges", sources: [{ kind: "point", key: graph.points.find(p => p.id === "detail")!.key }],
      target: { kind: "point", key: graph.points.find(p => p.id === "child")!.key }
    })]);
    expect(header.annotation, family + suffix + closer).toMatchObject({ kind: "bearing", syntaxErrors: expect.arrayContaining(["retired"]) });
  });

  it.each(["node", "NODE", "edge", "EDGE"])("keeps %s uses and notes failed, including malformed and unclosed headers", family => {
    for (const suffix of [" use @p", " use", " use @p; @alias", " note", " note @target", " note; @alias"]) {
      for (const closer of ["]", ""]) {
        const note = suffix.startsWith(" note"), bearing = family.toLowerCase() === "edge";
        const result = explainSource(`- [. @p] Material.\n- [C @outer] Outer.\n  - [${family}${suffix}${closer}\n    - [G @child] Descendant.\n      - [O] Detail.`);
        const graph = result.graphs[0], block = result.documents[0].blocks[1].children[0];
        expect(result.diagnostics.filter(d => d.code === "RETIRED_FAMILY_ALIAS"), family + suffix + closer).toHaveLength(1);
        expect(graph.bearings.some(b => b.sourceSpan?.startLine === 3), family + suffix + closer).toBe(false);
        expect(graph.bearings.some(b => b.target.key === graph.points.find(p => p.id === "outer")!.key), family + suffix + closer).toBe(false);
        if (note) {
          expect(block.annotation).toMatchObject({ kind: "note", syntaxErrors: ["note"] });
          expect(block.children[0].annotation).toBeUndefined();
          expect(graph.points.map(p => p.id)).toEqual(["p", "outer"]);
          expect(graph.notes).toEqual([]);
        } else if (bearing) {
          expect(block.annotation).toMatchObject({ kind: "bearingUse", syntaxErrors: ["reference"] });
        }
      }
    }
  });

  it("keeps an uppercase BEARING use's failed operation boundary", () => {
    const result = explainSource("- [C] Outer.\n  - [BEARING use @r]\n    - [G] Cannot acquire an outer default.");
    expect(result.documents[0].blocks[0].children[0].annotation).toMatchObject({ kind: "bearingUse", syntaxErrors: ["reference"] });
    expect(result.graphs[0].bearings).toEqual([]);
    expect(result.diagnostics.map(d => d.code)).toContain("BEARING_USE_REQUIRES_EXPLICIT_TARGET");
  });

  it("makes the published ordinary-body counterexample an explicit 0.6 migration boundary", () => {
    const result = explainSource("- [C @outer] Outer.\n  - [point @p] Previously ordinary body.\n    - [G @g] Reason.");
    const g = result.graphs[0];
    expect(g.points.map(p => p.id)).toEqual(["outer", "p", "g"]);
    expect(g.bearings.map(b => [b.kind, b.sources, b.target])).toEqual([
      ["concerns", [{ kind: "point", key: g.points[1].key }], { kind: "point", key: g.points[0].key }],
      ["supports", [{ kind: "point", key: g.points[2].key }], { kind: "point", key: g.points[1].key }]
    ]);
    expect(result.version).toBe("0.7.0");
  });
});
